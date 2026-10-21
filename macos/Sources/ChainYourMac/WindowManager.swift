import AppKit

struct Column {
    var windows: [AXWindow]
    var widthFrac: CGFloat
    var active = 0
}

/// Holds the horizontal strip of columns and positions real windows to match it.
final class WindowManager {
    private(set) var columns: [Column] = []
    private(set) var focus = 0
    private var offset: CGFloat = 0
    private var seeded = false
    private var animTimer: Timer?
    private var pollTimer: Timer?

    var enabled = true {
        didSet { if enabled { sync(); layout() } }
    }

    var gap: CGFloat {
        didSet { UserDefaults.standard.set(Double(gap), forKey: "gap"); layout() }
    }

    var defaultWidth: CGFloat {
        didSet { UserDefaults.standard.set(Double(defaultWidth), forKey: "defaultWidth") }
    }

    init() {
        let d = UserDefaults.standard
        gap = CGFloat(d.object(forKey: "gap") as? Double ?? 12)
        defaultWidth = CGFloat(d.object(forKey: "defaultWidth") as? Double ?? 0.5)
    }

    // MARK: Geometry

    /// Usable screen area in Accessibility coordinates (origin top-left of the primary display).
    var area: CGRect {
        let screens = NSScreen.screens
        let screen = NSScreen.main ?? screens[0]
        let primaryH = screens[0].frame.height
        let vf = screen.visibleFrame
        return CGRect(x: vf.minX, y: primaryH - vf.maxY, width: vf.width, height: vf.height)
    }

    /// Column width so that 1/frac columns plus gaps exactly fill the screen.
    private func width(of col: Column, in a: CGRect) -> CGFloat {
        max(200, floor(col.widthFrac * (a.width - gap) - gap))
    }

    private func targetOffset() -> CGFloat {
        let a = area
        guard columns.indices.contains(focus) else { return 0 }
        let widths = columns.map { width(of: $0, in: a) }
        let total = widths.reduce(gap) { $0 + $1 + gap }
        let leading = widths.prefix(focus).reduce(gap) { $0 + $1 + gap }
        let centered = leading + widths[focus] / 2 - a.width / 2
        return max(0, min(centered, max(0, total - a.width)))
    }

    // MARK: Lifecycle

    func start() {
        sync()
        layout()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    private func tick() {
        guard enabled, animTimer == nil else { return }
        sync()
        followSystemFocus()
    }

    /// Add new windows to the strip, drop closed ones.
    func sync() {
        let current = AXWindow.all()
        var changed = false

        for ci in columns.indices {
            let before = columns[ci].windows.count
            columns[ci].windows.removeAll { w in !current.contains { $0.matches(w.element) } }
            if columns[ci].windows.count != before { changed = true }
            columns[ci].active = min(columns[ci].active, max(0, columns[ci].windows.count - 1))
        }
        columns.removeAll { $0.windows.isEmpty }

        let known = columns.flatMap { $0.windows }
        var fresh = current.filter { c in !known.contains { $0.matches(c.element) } }
        if !fresh.isEmpty {
            changed = true
            if !seeded {
                fresh.sort { ($0.frame?.minX ?? 0) < ($1.frame?.minX ?? 0) }
                columns.append(contentsOf: fresh.map { Column(windows: [$0], widthFrac: defaultWidth) })
            } else {
                var at = columns.isEmpty ? 0 : focus + 1
                for w in fresh {
                    columns.insert(Column(windows: [w], widthFrac: defaultWidth), at: at)
                    focus = at
                    at += 1
                }
            }
        }
        seeded = true
        focus = columns.isEmpty ? 0 : min(focus, columns.count - 1)
        if changed {
            layout()
            raiseActive()
        }
    }

    /// If the user focused a window some other way (Cmd-Tab, click), scroll the strip to it.
    private func followSystemFocus() {
        guard let el = AXWindow.focusedWindowOfFrontApp() else { return }
        for (ci, col) in columns.enumerated() {
            if let wi = col.windows.firstIndex(where: { $0.matches(el) }) {
                if ci != focus || col.active != wi {
                    focus = ci
                    columns[ci].active = wi
                    scroll(animated: true)
                }
                return
            }
        }
    }

    // MARK: Layout

    /// Resize and reposition every window.
    func layout() {
        guard enabled, !columns.isEmpty else { return }
        animTimer?.invalidate()
        animTimer = nil
        offset = targetOffset()
        apply(offset: offset, resize: true)
    }

    /// Slide the strip so the focused column is centered.
    private func scroll(animated: Bool) {
        guard enabled, !columns.isEmpty else { return }
        let from = offset
        let to = targetOffset()
        animTimer?.invalidate()
        animTimer = nil
        guard animated, abs(to - from) > 1 else {
            offset = to
            apply(offset: to, resize: false)
            return
        }
        let frames = 10
        var i = 0
        animTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] t in
            guard let self else { t.invalidate(); return }
            i += 1
            let p = CGFloat(i) / CGFloat(frames)
            let eased = 1 - pow(1 - p, 3)
            self.offset = from + (to - from) * eased
            self.apply(offset: self.offset, resize: false)
            if i >= frames {
                t.invalidate()
                self.animTimer = nil
            }
        }
    }

    private func apply(offset: CGFloat, resize: Bool) {
        let a = area
        var x = a.minX + gap - offset
        for col in columns {
            let w = width(of: col, in: a)
            let n = CGFloat(col.windows.count)
            let h = max(100, (a.height - gap * (n + 1)) / n)
            // Keep a 2px sliver on screen for parked windows so macOS never treats them as lost.
            let px = min(max(x, a.minX - w + 2), a.maxX - 2)
            for (k, win) in col.windows.enumerated() {
                let y = a.minY + gap + CGFloat(k) * (h + gap)
                if resize {
                    win.setFrame(CGRect(x: px, y: y, width: w, height: h))
                } else {
                    win.setPosition(CGPoint(x: px, y: y))
                }
            }
            x += w + gap
        }
    }

    private func raiseActive() {
        guard columns.indices.contains(focus) else { return }
        let col = columns[focus]
        guard col.windows.indices.contains(col.active) else { return }
        col.windows[col.active].raise()
    }

    // MARK: Commands

    func focusColumn(_ delta: Int) {
        guard !columns.isEmpty else { return }
        focus = max(0, min(columns.count - 1, focus + delta))
        scroll(animated: true)
        raiseActive()
    }

    func focusWithinStack(_ delta: Int) {
        guard columns.indices.contains(focus) else { return }
        let n = columns[focus].windows.count
        columns[focus].active = max(0, min(n - 1, columns[focus].active + delta))
        raiseActive()
    }

    func moveColumn(_ delta: Int) {
        let to = focus + delta
        guard columns.indices.contains(focus), columns.indices.contains(to) else { return }
        columns.swapAt(focus, to)
        focus = to
        layout()
    }

    func setWidth(_ frac: CGFloat) {
        guard columns.indices.contains(focus) else { return }
        columns[focus].widthFrac = frac
        layout()
        scroll(animated: false)
    }

    /// Pull the right-hand neighbour into the focused column as a stack.
    func stackRight() {
        guard columns.indices.contains(focus + 1) else { return }
        columns[focus].windows.append(contentsOf: columns[focus + 1].windows)
        columns.remove(at: focus + 1)
        layout()
    }

    /// Push the last window of a stacked column out into its own column on the right.
    func unstack() {
        guard columns.indices.contains(focus), columns[focus].windows.count > 1 else { return }
        let w = columns[focus].windows.removeLast()
        columns[focus].active = min(columns[focus].active, columns[focus].windows.count - 1)
        columns.insert(Column(windows: [w], widthFrac: columns[focus].widthFrac), at: focus + 1)
        layout()
    }
}
