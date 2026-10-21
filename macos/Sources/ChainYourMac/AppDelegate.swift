import AppKit
import Carbon.HIToolbox

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let manager = WindowManager()
    private var statusItem: NSStatusItem!
    private var trustTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        registerHotKeys()

        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        if AXIsProcessTrustedWithOptions(opts) {
            manager.start()
        } else {
            // Wait for the user to grant Accessibility access in System Settings.
            trustTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] t in
                if AXIsProcessTrusted() {
                    t.invalidate()
                    self?.manager.start()
                }
            }
        }
    }

    // MARK: Hotkeys (Control + Option + key)

    private func registerHotKeys() {
        let mods = controlKey | optionKey
        let shifted = mods | shiftKey
        let hk = HotKeys.shared
        hk.register(keyCode: kVK_LeftArrow, modifiers: mods) { [m = manager] in m.focusColumn(-1) }
        hk.register(keyCode: kVK_RightArrow, modifiers: mods) { [m = manager] in m.focusColumn(1) }
        hk.register(keyCode: kVK_UpArrow, modifiers: mods) { [m = manager] in m.focusWithinStack(-1) }
        hk.register(keyCode: kVK_DownArrow, modifiers: mods) { [m = manager] in m.focusWithinStack(1) }
        hk.register(keyCode: kVK_LeftArrow, modifiers: shifted) { [m = manager] in m.moveColumn(-1) }
        hk.register(keyCode: kVK_RightArrow, modifiers: shifted) { [m = manager] in m.moveColumn(1) }
        hk.register(keyCode: kVK_ANSI_1, modifiers: mods) { [m = manager] in m.setWidth(1.0 / 3.0) }
        hk.register(keyCode: kVK_ANSI_2, modifiers: mods) { [m = manager] in m.setWidth(0.5) }
        hk.register(keyCode: kVK_ANSI_3, modifiers: mods) { [m = manager] in m.setWidth(2.0 / 3.0) }
        hk.register(keyCode: kVK_ANSI_4, modifiers: mods) { [m = manager] in m.setWidth(1.0) }
        hk.register(keyCode: kVK_ANSI_S, modifiers: mods) { [m = manager] in m.stackRight() }
        hk.register(keyCode: kVK_ANSI_U, modifiers: mods) { [m = manager] in m.unstack() }
        hk.register(keyCode: kVK_ANSI_R, modifiers: mods) { [m = manager] in m.sync(); m.layout() }
    }

    // MARK: Menu bar

    private func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "⛓"

        let menu = NSMenu()
        let toggle = NSMenuItem(title: "Tiling enabled", action: #selector(toggleTiling(_:)), keyEquivalent: "")
        toggle.state = .on
        menu.addItem(toggle)
        menu.addItem(withTitle: "Retile now", action: #selector(retile), keyEquivalent: "")
        menu.addItem(.separator())

        let widthMenu = NSMenu()
        for (title, frac) in [("Third", 1.0 / 3.0), ("Half", 0.5), ("Two thirds", 2.0 / 3.0)] {
            let item = NSMenuItem(title: title, action: #selector(pickDefaultWidth(_:)), keyEquivalent: "")
            item.representedObject = frac
            widthMenu.addItem(item)
        }
        let widthItem = NSMenuItem(title: "Default width for new windows", action: nil, keyEquivalent: "")
        widthItem.submenu = widthMenu
        menu.addItem(widthItem)

        let gapMenu = NSMenu()
        for g in [0, 8, 12, 20, 30] {
            let item = NSMenuItem(title: "\(g) px", action: #selector(pickGap(_:)), keyEquivalent: "")
            item.representedObject = g
            gapMenu.addItem(item)
        }
        let gapItem = NSMenuItem(title: "Gap", action: nil, keyEquivalent: "")
        gapItem.submenu = gapMenu
        menu.addItem(gapItem)

        menu.addItem(.separator())
        let help = [
            "⌃⌥ ← →   focus column",
            "⌃⌥ ↑ ↓   focus within stack",
            "⌃⌥⇧ ← →   move column",
            "⌃⌥ 1 2 3 4   width: ⅓ ½ ⅔ full",
            "⌃⌥ S   stack right neighbour",
            "⌃⌥ U   unstack last window",
            "⌃⌥ R   rescan and retile",
        ]
        for line in help {
            let item = NSMenuItem(title: line, action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Chain Your Mac", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        for item in menu.items where item.action != nil && item.action != #selector(NSApplication.terminate(_:)) {
            item.target = self
        }
        for sub in [widthMenu, gapMenu] { sub.items.forEach { $0.target = self } }
        statusItem.menu = menu
    }

    @objc private func toggleTiling(_ sender: NSMenuItem) {
        manager.enabled.toggle()
        sender.state = manager.enabled ? .on : .off
    }

    @objc private func retile() {
        manager.sync()
        manager.layout()
    }

    @objc private func pickDefaultWidth(_ sender: NSMenuItem) {
        if let f = sender.representedObject as? Double { manager.defaultWidth = CGFloat(f) }
    }

    @objc private func pickGap(_ sender: NSMenuItem) {
        if let g = sender.representedObject as? Int { manager.gap = CGFloat(g) }
    }
}
