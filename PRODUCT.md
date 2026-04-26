# Product

## Register

product

## Users

Two overlapping audiences:

**Primary — Emergency management professionals.** Incident commanders, EOC staff, fire agency planners using PyroTech in a prevention and preparedness context. They think in ICS structure, read maps instinctively, and trust data-dense interfaces. They need the tool to feel operationally credible — not like a toy or a slideshow.

**Secondary — Informed general public.** People with personal stakes in wildfire risk: residents, journalists, researchers, students. They can follow a simulation if the UI gives them legible entry points, but they'll disengage if the interface is opaque or feels like it's for specialists only.

The tension to resolve: expert density without gatekeeping. The map and agent feed are the product — everything else should support comprehension, not demand it.

## Product Purpose

PyroTech simulates real-time wildfire incident command using a multi-agent AI orchestration layer. Seven specialized LLM agents coordinate a disaster response — modeling fire spread, evacuation flows, resource deployment, infrastructure damage, and public communications — over a physics-informed geospatial map.

Success looks like: a user can configure a real-world scenario, watch the simulation unfold, understand why each decision was made, and walk away with a credible mental model of how wildfire response actually works.

## Brand Personality

Tactical, urgent, realistic.

The interface should feel like it belongs in a real Emergency Operations Center — not a game, not a SaaS product, not a research poster. The tone is serious and operational. When the fire spreads, the UI should feel like something is actually at stake.

## Anti-references

- **Games**: PyroTech must not look like a strategy game or a disaster sim game. No health bars, no score counters, no game-UI chrome.
- **Generic dashboards**: Not Grafana, not Tableau, not any BI tool that could be repurposed for anything. Every element should feel specific to wildfire incident command.
- **Conversational AI interfaces**: Not Claude, not ChatGPT. The agent feed is a radio net, not a chat window.
- **Consumer news/weather apps**: No panic aesthetics, no over-saturated breaking-news red banners, no Weather.com color gradients.

## Design Principles

1. **The simulation is the interface.** The map and agent radio feed are the product. UI chrome should recede — serve comprehension, never compete with it.

2. **Operational credibility over polish.** Every element should feel like it has a reason to exist in an EOC. Skeptical professionals should look at this and think "this is real," not "someone made this look cool."

3. **Urgency is earned.** Color and motion signal actual state changes in the simulation — not decoration, not branding. A red pulse means something is on fire. A blinking indicator means something is actively happening.

4. **Dense but legible.** Experts read density as signal. General public reads density as noise. Solve this by layering: primary information is always legible; detail is available for those who look deeper.

5. **Radio net, not chat.** The agent feed is a coordinated multi-voice radio transmission. It has cadence, hierarchy, and interruption patterns. It should not look like a messaging app.

## Accessibility & Inclusion

Demo and showcase purposes — no hard WCAG compliance requirement. Maintain sufficient color contrast for core map and text elements. Motion is acceptable. Color blindness accommodations are desirable but not blocking.
