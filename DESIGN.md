---
name: Ember
description: Multi-agent AI wildfire incident command simulation
colors:
  background: "oklch(6% 0.008 24)"
  surface: "oklch(9% 0.009 24)"
  surface-raised: "oklch(13% 0.009 24)"
  border-subtle: "oklch(15% 0.007 24)"
  border: "oklch(21% 0.007 24)"
  border-bright: "oklch(30% 0.008 24)"
  text-primary: "oklch(84% 0.005 24)"
  text-secondary: "oklch(50% 0.005 24)"
  text-muted: "oklch(34% 0.005 24)"
  incident-amber: "oklch(68% 0.18 45)"
  fire-red: "oklch(63% 0.22 27)"
  evacuation-blue: "oklch(66% 0.17 237)"
  operational-green: "oklch(68% 0.17 154)"
  clock-yellow: "oklch(72% 0.16 58)"
  command-purple: "oklch(66% 0.18 292)"
typography:
  headline:
    fontFamily: "Barlow Condensed, system-ui, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 800
    letterSpacing: "0.1em"
    lineHeight: 1
  title:
    fontFamily: "Barlow Condensed, system-ui, sans-serif"
    fontSize: "0.65rem"
    fontWeight: 700
    letterSpacing: "0.18em"
    lineHeight: 1
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "0.84rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Barlow Condensed, system-ui, sans-serif"
    fontSize: "0.56rem"
    fontWeight: 400
    letterSpacing: "0.14em"
    lineHeight: 1
  mono:
    fontFamily: "Geist Mono, 'Courier New', monospace"
    fontSize: "0.88rem"
    fontWeight: 600
    lineHeight: 1
rounded:
  sharp: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
  xl: "24px"
components:
  button-control:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sharp}"
    padding: "0 14px"
    height: "30px"
  button-control-hover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sharp}"
    padding: "0 14px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.fire-red}"
    rounded: "{rounded.sharp}"
    padding: "0 14px"
  button-command:
    backgroundColor: "transparent"
    textColor: "{colors.command-purple}"
    rounded: "{rounded.sharp}"
    padding: "0 14px"
  chip-preset:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sharp}"
    padding: "4px 14px"
  chip-preset-active:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sharp}"
    padding: "4px 14px"
---

# Design System: Ember

## 1. Overview

**Creative North Star: "The Operations Room"**

The EOC at 02:00. A wildfire on radar. Seven radio channels transmitting simultaneously. The map is the source of truth. Every element in this UI is a readout — not decoration, not branding. The interface exists to serve the simulation; the simulation exists to be taken seriously.

This system commits to near-complete chromatic suppression. Surfaces are deep near-black, tinted warmly toward fire hue. Text is a narrow off-white. The semantic vocabulary — six status accents, each assigned to an incident function — is the only color that moves. The brand amber (Incident Amber) appears in precisely two places: the logotype and the 2px top stripe on the header. Its rarity is its authority.

Barlow Condensed does all the labeling: section headers, callsigns, metrics labels, button text — compressed, uppercase, tracked wide, operating at 0.56–0.72rem. Barlow body appears only where prose is permitted: the agent transmission feed. Geist Mono holds all numeric data. This three-role type hierarchy is strict. No decorative type; every font choice is functional.

This system rejects: strategy game UI chrome, generic BI dashboard layouts (Grafana, Tableau), conversational AI chat windows, consumer weather app color gradients. If a professional incident commander sat at this screen at 2am, the interface should read as infrastructure, not a demonstration.

**Key Characteristics:**
- Near-zero radius (2px universally). Angular geometry signals industrial precision.
- Semantic color, not decorative color. Red means fire. Blue means evacuation movement. Yellow means simulation time. These colors do not appear outside their assigned function.
- Condensed type at micro scale. All UI labeling is compressed, uppercase, tracked — maximum density without legibility compromise.
- Flat tonal depth. Three surface levels; zero shadows. Separation by tone and 1px borders.
- Amber as the single brand signal. Incident Amber appears in the logotype and the header accent stripe. Nowhere else as decoration.

## 2. Colors: The Incident Palette

A near-monochrome field of warm darks, with six semantic signal colors and one brand anchor.

### Primary (Brand)
- **Incident Amber** (`oklch(68% 0.18 45)`): The sole brand color. Used for the EMBER logotype and the 2px top border on the dashboard header. Doubles as the `--accent-orange` status signal for congestion and route closures. When it appears outside these two roles, it reads as a system alert — that reading is correct.

### Neutral (Surfaces and Text)
- **Incident Black** (`oklch(6% 0.008 24)`): The page background. The darkest surface. Never pure black — trace warmth at hue 24 keeps it from reading as void.
- **Panel Ash** (`oklch(9% 0.009 24)`): The panel and card surface. Headers, feed panel, metrics bar background.
- **Raised Console** (`oklch(13% 0.009 24)`): Elevated interactive surface. Hover state for control buttons. Chip active state.
- **Panel Seam (Subtle)** (`oklch(15% 0.007 24)`): The lightest separator. Row dividers within the agent feed.
- **Panel Seam** (`oklch(21% 0.007 24)`): Standard border. Used for every structural division — header bottom, panel left edge, MetricItem dividers.
- **Panel Seam (Bright)** (`oklch(30% 0.008 24)`): Emphasis border for elements requiring more presence than a standard seam.
- **CRT Warm White** (`oklch(84% 0.005 24)`): Primary text. Agent transmission body copy. Slightly warm, never pure white.
- **Radio Grey** (`oklch(50% 0.005 24)`): Secondary text. Non-primary metric values, secondary agent transmissions (opacity 0.72 on the transmission body).
- **Dead Air** (`oklch(34% 0.005 24)`): Muted text. Section labels, status indicators, empty-state text, all uppercase UI chrome.

### Secondary (Semantic Status)
- **Fire Red** (`oklch(63% 0.22 27)`): Fire spread metrics, danger actions (Stop button), and all fire-related map events. The highest-urgency signal.
- **Evacuation Blue** (`oklch(66% 0.17 237)`): Evacuation flows and evacuee counts. Movement.
- **Operational Green** (`oklch(68% 0.17 154)`): Connected state, shelter occupancy, safe status. The absence of danger.
- **Clock Yellow** (`oklch(72% 0.16 58)`): Simulation time readout. The temporal axis of the incident.
- **Command Purple** (`oklch(66% 0.18 292)`): Population at risk, IAP/Playbook action, command-level functions.

### Named Rules
**The One Signal Rule.** Each status color maps to exactly one incident function. Fire Red is never used for a non-fire element. Operational Green is never used as a UI positive-state affordance outside the connected indicator. The semantic assignments are the system; they cannot be borrowed for decorative or emphasis purposes.

**The Amber Authority Rule.** Incident Amber (`--accent`) appears in the logotype and the 2px header top border. These are its two permitted structural uses. When it reappears as `--accent-orange` in status metrics, it reads as a congestion or route-closure signal. Never use it as a general highlight or hover color.

## 3. Typography: The Condensed Net

**Primary Font:** Barlow Condensed (weights 400–800, with Barlow for body)
**Body Font:** Barlow (weights 300–700)
**Mono Font:** Geist Mono

**Character:** Barlow Condensed dominates. Its compressed, military-grade letterforms pack maximum information into minimal vertical and horizontal space. Barlow body appears only in agent transmissions — the one surface where legible prose matters. Geist Mono anchors all numeric data with tabular precision.

### Hierarchy
- **Headline** (Barlow Condensed, 800, 1.2rem, lh 1, tracking 0.1em, uppercase): The EMBER logotype in the dashboard header. Used nowhere else.
- **Title** (Barlow Condensed, 700, 0.65rem, lh 1, tracking 0.18em, uppercase): Section panel headers ("Agent Transmissions", "ICS Unified Command"). The primary UI labeling register.
- **Body** (Barlow, 400, 0.84rem, lh 1.65): Agent transmission prose. The only place running text appears. Max line length governed by the 40% feed panel width.
- **Label** (Barlow Condensed, 400–600, 0.56–0.72rem, tracking 0.1–0.18em, uppercase): MetricItem labels, callsign tags, button text, hint text, status strings. The workhorse.
- **Mono** (Geist Mono, 600, 0.8–1.05rem, tracking 0.02–0.06em): MetricItem values, simulation clock, data readouts. Always tabular-nums.

### Named Rules
**The Condensed Lockdown Rule.** Barlow Condensed is used for every UI element that navigates, labels, categorizes, or controls. It does not appear in agent transmission body copy. Barlow body does not appear in UI chrome. These roles do not cross.

**The Micro Label Rule.** UI labels operate at 0.56–0.72rem with letter-spacing of 0.1em or more. At this scale, condensed letterforms with wide tracking are more legible than proportional type at the same size. Do not increase label font size to compensate for tracking — the compressed density is the aesthetic.

## 4. Elevation

This system is flat. There are no shadows, no blurs, no glassmorphic treatments. Depth is conveyed entirely through tonal layering (background → surface → surface-raised) and 1px border separations (border-subtle → border → border-bright).

The three surface levels function like hardware panel layers: the background is the chassis, the surface is the installed panel, surface-raised is the active or hovered state. Any element that appears to "float" does so through tone and border contrast alone.

**The Flat-By-Default Rule.** If you are reaching for `box-shadow`, `backdrop-filter`, or `filter: blur`, stop. Redesign the element using tonal surfaces and borders. Shadows are prohibited. Glassmorphism is prohibited. The EOC aesthetic is matte, not luminous.

## 5. Components

### Buttons (SimControl)

Sim controls are the command actions — Pause, Resume, Stop, Playbook. They are bare and functional.

- **Shape:** Nearly square corners (2px radius). Height: 30px. Padding: 0 14px.
- **Default:** Transparent background. 1px border at `--border`. Text in `--text-secondary` (neutral), `--accent-red` (danger), or `--accent-purple` (command). Barlow Condensed, 0.72rem, weight 600, letter-spacing 0.12em, uppercase.
- **Hover:** Background transitions to `--surface-raised` (0.15s ease). Border color holds. Text color holds.
- **Active/Danger:** Color swap via prop — text color is the only visual differentiator between variants. No filled backgrounds in any state.
- **No icons.** Text labels only. Uppercase, terse.

### Chips (Scenario Presets)

Used in the setup form to select preset scenarios.

- **Inactive:** Transparent background, 1px `--border` border, 2px radius, `--text-muted` text. Barlow Condensed, 0.65rem.
- **Active:** `--surface-raised` background, `--border` border, `--text-primary` text. No filled accent color — selection is signaled by surface lift only.

### MetricItem (Data Readout)

The atomic unit of the MetricsBar. A stacked value-over-label pair.

- **Value:** Geist Mono, 0.88–1.05rem (primary metric), weight 600, tabular-nums. Color is the assigned semantic accent for that metric (fire-red for acres, evacuation-blue for evacuees, etc.). Transitions on value change: `all 0.5s ease-out`.
- **Label:** Barlow Condensed, 0.56rem, tracking 0.14em, uppercase, `--text-muted`.
- **Divider:** 1px vertical line at `--border`, 22px tall. Inserted between every MetricItem.

### Agent Callsign Row

The header of each agent transmission in the feed.

- **Callsign:** Barlow Condensed, 0.7rem, weight 700, tracking 0.14em, uppercase. Color is the agent's assigned status color (one of the six semantic accents). Flex-shrink: 0.
- **Horizontal rule:** 1px line extending to the right of the callsign, at the agent's color with 15% opacity. Signals channel without decorating.
- **Transmitting indicator:** When streaming, a "Transmitting" label appears right-aligned — Barlow Condensed, 0.58rem, uppercase, `--text-muted`, with `pulse-glow` animation.
- **Support agents** (Infrastructure, Communications): opacity 0.72 on the full transmission block. Secondary voice on the net.

### Section Panel Header

The title bar of each panel region.

- **Text:** Barlow Condensed, 0.65rem, weight 700, tracking 0.18em, uppercase, `--text-muted`. No colored accent.
- **Container:** 1px bottom border at `--border`. Background: `--panel-bg`. Padding: 0.5rem 1rem.
- **No decorative elements.** No icons, no colored stripe, no badge. The label is the entire affordance.

### Dashboard Header

The 44px application header.

- **Top stripe:** 2px solid `--accent` (Incident Amber). The only structural decoration in the entire UI.
- **Bottom border:** 1px `--border`.
- **Background:** `--panel-bg`.
- Contains: back navigation (ghost button), EMBER logotype (condensed, 800, 1.2rem, amber), incident role label, simulation clock, connection status dot + label.

### Status Dot

A 7px circle indicating connection or simulation state.

- **Active:** `--accent-green` fill.
- **Inactive/Error:** `--accent-red` fill.
- No border. No shadow. Color alone carries the signal.

### Simulation Active Badge

An absolute-positioned overlay on the map when simulation is running.

- **No border-radius.** Hard rectangular clip.
- **Background:** `--accent-red`. Text: near-white (`oklch(96% 0.003 24)`). Barlow Condensed, 0.65rem, weight 700, tracking 0.16em, uppercase.
- **Animation:** `pulse-glow` (opacity 0.6→1, 2s ease-in-out infinite). The pulsing is the only motion allowed on this element.

## 6. Do's and Don'ts

### Do:
- **Do** use semantic accent colors for their assigned incident function only — Fire Red for fire metrics, Evacuation Blue for movement data, Operational Green for safe/connected status, Clock Yellow for time, Command Purple for population or command functions, Incident Amber for the brand logotype and header stripe.
- **Do** use Barlow Condensed for all UI labeling, section titles, button text, callsigns, and chip labels. Uppercase, tracked wide.
- **Do** use Geist Mono for all numeric data readouts with `font-variant-numeric: tabular-nums`.
- **Do** use Barlow body (0.84rem, lh 1.65) exclusively for agent transmission prose — the one surface where running text appears.
- **Do** use 2px border-radius on every interactive element. The sharp geometry is load-bearing aesthetic.
- **Do** signal state changes with color and opacity. The `pulse-glow` animation (opacity only, ease-in-out) is permitted for live-state indicators.
- **Do** use the three-layer tonal surface stack (background → surface → surface-raised) and 1px border separations to express depth. No shadows.
- **Do** use inline styles when precision matters. Tailwind utilities introduce rounding errors at micro-type scales.

### Don't:
- **Don't** make this look like a strategy game or disaster sim game. No health bars, score counters, or game-UI chrome. If an element looks like it belongs in a game HUD, remove it.
- **Don't** make this look like a generic BI dashboard (Grafana, Tableau, Metabase). Every element must feel specific to wildfire incident command.
- **Don't** make the agent feed look like a messaging app or chat window. It is a radio net — callsigns, transmission prose, channel separators — not a chat interface.
- **Don't** use consumer weather app aesthetics: no over-saturated red banners, no Weather.com gradients, no breaking-news urgency styling.
- **Don't** add `box-shadow`, `backdrop-filter`, or `filter: blur` to any element. Flat is not a limitation; it is the system.
- **Don't** use Incident Amber as a hover color, highlight, or emphasis tool outside its two structural roles (logotype, header stripe / congestion status signal).
- **Don't** use `border-left` greater than 1px as a colored accent stripe on any panel, card, or list item. If a visual signal is needed, use a full border, a tonal background, or a leading callsign label.
- **Don't** use gradient text (`background-clip: text` with a gradient). All text is a single solid color.
- **Don't** use glassmorphism or semi-transparent blur panels decoratively. This is an operational instrument, not a glass surface.
- **Don't** show the Mapbox attribution logo (`mapboxgl-ctrl-logo`, `mapboxgl-ctrl-attrib` are suppressed in globals.css — keep them suppressed). The map is the product; credits are noise during command.
- **Don't** add font sizes larger than 1.2rem to UI chrome. The headline scale is reserved for the EMBER logotype alone. If something looks big, it probably shouldn't.
