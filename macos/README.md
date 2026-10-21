# Chain Your Mac (rebuild)

A scrolling window manager for macOS. Windows sit in columns on one horizontal strip. The strip
slides so the focused column stays centered, and opening a window never resizes the others.

Native Swift menu bar app. Moves other apps' windows through the Accessibility API.
Requires macOS 13+.

## Build and run

    ./scripts/build_app.sh
    open build/ChainYourMac.app

On first launch, grant Accessibility access in System Settings > Privacy & Security > Accessibility.
The app starts tiling as soon as access is granted.

## Shortcuts (Control + Option)

| Keys | Action |
| --- | --- |
| left / right | focus previous / next column |
| up / down | focus within a stacked column |
| shift + left / right | move column |
| 1 2 3 4 | column width: third, half, two thirds, full |
| S | stack the right neighbour into this column |
| U | unstack the last window |
| R | rescan windows and retile |

Gap size and default width live in the menu bar menu.

## Known limits (v0.1)

- Single display (uses the main screen).
- Only windows on the current Space are managed.
- Windows are discovered by polling every 0.6s, so a new window takes a moment to join the strip.
- Some apps enforce a minimum window size and may not shrink to a narrow column.
