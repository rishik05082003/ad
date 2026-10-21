import AppKit
import ApplicationServices

/// Thin wrapper around an Accessibility window element belonging to another app.
final class AXWindow {
    let element: AXUIElement
    let pid: pid_t
    var lastOrigin: CGPoint?
    var lastSize: CGSize?

    init(element: AXUIElement, pid: pid_t) {
        self.element = element
        self.pid = pid
    }

    func matches(_ other: AXUIElement) -> Bool { CFEqual(element, other) }

    // MARK: Attribute helpers

    private func copy(_ attr: String) -> CFTypeRef? {
        var ref: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attr as CFString, &ref) == .success ? ref : nil
    }

    private func axValue<T>(_ attr: String, _ type: AXValueType, _ zero: T) -> T? {
        guard let ref = copy(attr), CFGetTypeID(ref) == AXValueGetTypeID() else { return nil }
        var out = zero
        return AXValueGetValue(ref as! AXValue, type, &out) ? out : nil
    }

    private func string(_ attr: String) -> String? { copy(attr) as? String }
    private func bool(_ attr: String) -> Bool? { copy(attr) as? Bool }

    // MARK: State

    var frame: CGRect? {
        guard let p: CGPoint = axValue(kAXPositionAttribute, .cgPoint, .zero),
              let s: CGSize = axValue(kAXSizeAttribute, .cgSize, .zero) else { return nil }
        return CGRect(origin: p, size: s)
    }

    /// Standard, visible, non-fullscreen windows only (no dialogs, palettes or minimized windows).
    var isTileable: Bool {
        guard string(kAXRoleAttribute) == kAXWindowRole,
              string(kAXSubroleAttribute) == kAXStandardWindowSubrole else { return false }
        if bool(kAXMinimizedAttribute) == true { return false }
        if bool("AXFullScreen") == true { return false }
        return frame != nil
    }

    // MARK: Actions

    func setPosition(_ point: CGPoint) {
        if let last = lastOrigin, last == point { return }
        var p = point
        if let v = AXValueCreate(.cgPoint, &p) {
            AXUIElementSetAttributeValue(element, kAXPositionAttribute as CFString, v)
            lastOrigin = point
        }
    }

    func setFrame(_ rect: CGRect) {
        if lastSize != rect.size {
            var s = rect.size
            if let v = AXValueCreate(.cgSize, &s) {
                AXUIElementSetAttributeValue(element, kAXSizeAttribute as CFString, v)
                lastSize = rect.size
            }
        }
        lastOrigin = nil
        setPosition(rect.origin)
    }

    func raise() {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(element, kAXMainAttribute as CFString, kCFBooleanTrue)
        AXUIElementPerformAction(element, kAXRaiseAction as CFString)
    }

    // MARK: Discovery

    static func all() -> [AXWindow] {
        var out: [AXWindow] = []
        for app in NSWorkspace.shared.runningApplications
        where app.activationPolicy == .regular && app.processIdentifier != getpid() {
            let ax = AXUIElementCreateApplication(app.processIdentifier)
            var ref: CFTypeRef?
            guard AXUIElementCopyAttributeValue(ax, kAXWindowsAttribute as CFString, &ref) == .success,
                  let list = ref as? [AXUIElement] else { continue }
            for el in list {
                let w = AXWindow(element: el, pid: app.processIdentifier)
                if w.isTileable { out.append(w) }
            }
        }
        return out
    }

    static func focusedWindowOfFrontApp() -> AXUIElement? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              app.processIdentifier != getpid() else { return nil }
        let ax = AXUIElementCreateApplication(app.processIdentifier)
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(ax, kAXFocusedWindowAttribute as CFString, &ref) == .success,
              let ref, CFGetTypeID(ref) == AXUIElementGetTypeID() else { return nil }
        return (ref as! AXUIElement)
    }
}
