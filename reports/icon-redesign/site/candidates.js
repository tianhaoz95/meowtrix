// candidates.js — 10 Distinct Icon Redesign Candidates for Meowtrix
// Each candidate provides a cohesive set of vector SVG icons replacing the emojis:
// 1. GPU (replacing 🎮)
// 2. Terminal Tab (replacing ⬛)
// 3. AI Agent Tab (replacing 🤖)
// 4. SSH Tab (replacing 🔗)
// 5. Browser Tab (replacing 🌐)
// 6. Code Editor Tab (replacing 📝)
// Plus extended cockpit icons:
// 7. Plan (replacing 📋)
// 8. Diffs (replacing 📂)
// 9. Reasoning (replacing 🧠)
// 10. Autonomous Mode (replacing ⚡)

window.ICON_CANDIDATES = [
  {
    id: "linear-precision",
    name: "Candidate 1: Linear Precision (Recommended)",
    badge: "Recommended",
    tagline: "Ultra-crisp 1.75px geometric line art modeled after Linear and Raycast.",
    description: "Engineered specifically for the 'Linear Slate' and 'Retina OLED' design system. Balanced stroke weight (1.75px), 24x24 optical grid alignment, 1.5px subtle corner fillets, and perfectly matched visual density with existing toolbar controls.",
    traits: ["1.75px Line Stroke", "Balanced Visual Density", "Clean Fillet Curves", "Native Toolbar Match"],
    icons: {
      gpu: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="5" width="14" height="14" rx="2.5"/>
  <rect x="9" y="9" width="6" height="6" rx="1"/>
  <path d="M9 2v3m6-3v3m-6 14v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>
</svg>`,
      terminal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="4 17 10 12 4 7"/>
  <line x1="12" y1="17" x2="20" y2="17"/>
</svg>`,
      agent: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2l2.4 5.6L20 10l-4.4 3.8L16.8 20 12 16.8 7.2 20l1.2-6.2L4 10l5.6-2.4L12 2z"/>
  <circle cx="12" cy="11.5" r="1.5"/>
</svg>`,
      ssh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="6" rx="2"/>
  <rect x="3" y="14" width="18" height="6" rx="2"/>
  <circle cx="7" cy="7" r="1" fill="currentColor"/>
  <circle cx="7" cy="17" r="1" fill="currentColor"/>
  <path d="M14 7h3m-3 10h3"/>
</svg>`,
      browser: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="2.5"/>
  <line x1="3" y1="9" x2="21" y2="9"/>
  <circle cx="6.5" cy="6.5" r="0.75" fill="currentColor"/>
  <circle cx="9.5" cy="6.5" r="0.75" fill="currentColor"/>
  <circle cx="12.5" cy="6.5" r="0.75" fill="currentColor"/>
</svg>`,
      editor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="16 18 22 12 16 6"/>
  <polyline points="8 6 2 12 8 18"/>
  <line x1="14" y1="4" x2="10" y2="20"/>
</svg>`,
      plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="4" width="16" height="16" rx="2"/>
  <polyline points="9 11 11 13 15 9"/>
  <line x1="9" y1="17" x2="15" y2="17"/>
</svg>`,
      diff: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="6" cy="6" r="3"/>
  <circle cx="6" cy="18" r="3"/>
  <line x1="6" y1="9" x2="6" y2="15"/>
  <circle cx="18" cy="9" r="3"/>
  <path d="M6 9a9 9 0 0 1 9-3h3"/>
</svg>`,
      brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <circle cx="12" cy="4" r="2"/>
  <circle cx="19" cy="8" r="2"/>
  <circle cx="19" cy="16" r="2"/>
  <circle cx="12" cy="20" r="2"/>
  <circle cx="5" cy="16" r="2"/>
  <circle cx="5" cy="8" r="2"/>
  <line x1="12" y1="6" x2="12" y2="9"/>
  <line x1="17.3" y1="9" x2="14.6" y2="10.5"/>
  <line x1="17.3" y1="15" x2="14.6" y2="13.5"/>
  <line x1="12" y1="18" x2="12" y2="15"/>
  <line x1="6.7" y1="15" x2="9.4" y2="13.5"/>
  <line x1="6.7" y1="9" x2="9.4" y2="10.5"/>
</svg>`,
      mode: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
</svg>`
    }
  },
  {
    id: "retina-oled-monoline",
    name: "Candidate 2: Retina OLED Monoline",
    badge: "High Contrast",
    tagline: "Crisp 2.0px pure white hairline strokes engineered for true black displays.",
    description: "Maximized contrast ratio and clarity for OLED screens. Every vector geometry avoids half-pixel antialiasing blur, guaranteeing pristine razor-sharp rendering on Retina glass and deep black panels.",
    traits: ["2.0px Stroke Weight", "Zero Blurring on True Black", "Maximum Geometric Contrast", "High Legibility at 12px"],
    icons: {
      gpu: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="4" width="16" height="16" rx="2"/>
  <line x1="8" y1="12" x2="16" y2="12"/>
  <line x1="12" y1="8" x2="12" y2="16"/>
  <line x1="4" y1="1" x2="4" y2="4"/>
  <line x1="12" y1="1" x2="12" y2="4"/>
  <line x1="20" y1="1" x2="20" y2="4"/>
  <line x1="4" y1="20" x2="4" y2="23"/>
  <line x1="12" y1="20" x2="12" y2="23"/>
  <line x1="20" y1="20" x2="20" y2="23"/>
</svg>`,
      terminal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <polyline points="7 10 10 13 7 16"/>
  <line x1="13" y1="16" x2="17" y2="16"/>
</svg>`,
      agent: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="6" width="16" height="12" rx="3"/>
  <circle cx="9" cy="12" r="1.5" fill="currentColor"/>
  <circle cx="15" cy="12" r="1.5" fill="currentColor"/>
  <line x1="12" y1="2" x2="12" y2="6"/>
  <line x1="2" y1="12" x2="4" y2="12"/>
  <line x1="20" y1="12" x2="22" y2="12"/>
</svg>`,
      ssh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
</svg>`,
      browser: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <line x1="3" y1="12" x2="21" y2="12"/>
  <path d="M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18"/>
</svg>`,
      editor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <polyline points="8 15 10 17 8 19"/>
  <line x1="13" y1="19" x2="16" y2="19"/>
</svg>`,
      plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
  <rect x="8" y="2" width="8" height="4" rx="1"/>
  <polyline points="9 13 11 15 15 11"/>
</svg>`,
      diff: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="8" height="18" rx="1"/>
  <rect x="13" y="3" width="8" height="18" rx="1"/>
  <line x1="7" y1="8" x2="7" y2="14"/>
  <line x1="17" y1="11" x2="17" y2="11"/>
</svg>`,
      brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2Z"/>
  <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2Z"/>
</svg>`,
      mode: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="13 2 4 13 12 13 11 22 20 11 12 11 13 2"/>
</svg>`
    }
  },
  {
    id: "phosphor-soft",
    name: "Candidate 3: Phosphor Soft Rounded",
    badge: "Modern Developer",
    tagline: "Approachable, rounded aesthetic inspired by GitHub Primer & Phosphor.",
    description: "Features welcoming curved contours, generous corner radii (3-4px), and softer terminal glyphs. Excellent choice for developers who prefer modern friendly developer tools like Zed and Cursor.",
    traits: ["Generous Radii", "Curved Endcaps", "Warm Developer Aesthetic", "Soft Optical Touch"],
    icons: {
      gpu: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="6" width="18" height="12" rx="4"/>
  <circle cx="8.5" cy="12" r="2.5"/>
  <circle cx="15.5" cy="12" r="2.5"/>
  <line x1="8.5" y1="12" x2="8.5" y2="12.01"/>
  <line x1="15.5" y1="12" x2="15.5" y2="12.01"/>
</svg>`,
      terminal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 8l4.5 4-4.5 4"/>
  <path d="M12 16h6"/>
</svg>`,
      agent: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3c-4.97 0-9 4.03-9 9 0 3.32 1.8 6.22 4.49 7.77L7 22l3.41-1.36c.51.09 1.04.14 1.59.14 4.97 0 9-4.03 9-9s-4.03-9-9-9z"/>
  <circle cx="9" cy="12" r="1"/>
  <circle cx="15" cy="12" r="1"/>
</svg>`,
      ssh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="5" width="16" height="6" rx="3"/>
  <rect x="4" y="13" width="16" height="6" rx="3"/>
  <path d="M8 8h1"/>
  <path d="M8 16h1"/>
</svg>`,
      browser: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="4"/>
  <path d="M3 10h18"/>
  <circle cx="7" cy="7" r="1"/>
  <circle cx="10" cy="7" r="1"/>
</svg>`,
      editor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
</svg>`,
      plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="3"/>
  <path d="M8 9h8m-8 4h5"/>
</svg>`,
      diff: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="7" cy="7" r="3"/>
  <circle cx="7" cy="17" r="3"/>
  <path d="M7 10v4"/>
  <circle cx="17" cy="7" r="3"/>
  <path d="M14 7h-4"/>
</svg>`,
      brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"/>
  <path d="M12 3v18"/>
  <path d="M3 12h18"/>
</svg>`,
      mode: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M13 2L4.5 13.5h6L9.5 22 19.5 10.5h-6.5L13 2z"/>
</svg>`
    }
  },
  {
    id: "technical-duotone",
    name: "Candidate 4: Technical Duotone",
    badge: "Depth & Hierarchy",
    tagline: "Crisp line silhouettes enhanced with subtle 12% translucent tint fills.",
    description: "Adds rich visual depth without clutter. The primary stroke defines structure while an embedded low-opacity tone fill (`fill-opacity=\"0.14\"`) makes tabs and toolbar indicators pop cleanly even at low screen brightness.",
    traits: ["Translucent Tint Fills", "Hierarchical Depth", "Rich Optical Weight", "Zero Visual Clutter"],
    icons: {
      gpu: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="5" width="16" height="14" rx="2.5" fill="currentColor" fill-opacity="0.12"/>
  <rect x="8" y="9" width="8" height="6" rx="1.5" stroke-dasharray="2 2"/>
  <path d="M7 2v3m10-3v3M7 19v3m10-3v3M1 8h3m-3 8h3m16-8h3m-3 8h3"/>
</svg>`,
      terminal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="3" fill="currentColor" fill-opacity="0.12"/>
  <polyline points="7 10 10 13 7 16"/>
  <line x1="13" y1="16" x2="17" y2="16"/>
</svg>`,
      agent: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2l2.5 5.5L20 10l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-2.5L12 2z" fill="currentColor" fill-opacity="0.14"/>
  <circle cx="12" cy="11.5" r="1.5" fill="currentColor"/>
</svg>`,
      ssh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="6" rx="2" fill="currentColor" fill-opacity="0.12"/>
  <rect x="3" y="14" width="18" height="6" rx="2" fill="currentColor" fill-opacity="0.12"/>
  <circle cx="7" cy="7" r="1.2" fill="currentColor"/>
  <circle cx="7" cy="17" r="1.2" fill="currentColor"/>
  <line x1="12" y1="7" x2="18" y2="7"/>
  <line x1="12" y1="17" x2="18" y2="17"/>
</svg>`,
      browser: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="2.5" fill="currentColor" fill-opacity="0.12"/>
  <line x1="3" y1="9" x2="21" y2="9"/>
  <circle cx="6" cy="6.5" r="1" fill="currentColor"/>
</svg>`,
      editor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="currentColor" fill-opacity="0.12"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="9" y1="13" x2="15" y2="13"/>
  <line x1="9" y1="17" x2="13" y2="17"/>
</svg>`,
      plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="4" width="16" height="16" rx="2.5" fill="currentColor" fill-opacity="0.12"/>
  <polyline points="8 12 10.5 14.5 16 9"/>
</svg>`,
      diff: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="8" height="18" rx="2" fill="currentColor" fill-opacity="0.12"/>
  <rect x="13" y="3" width="8" height="18" rx="2"/>
  <line x1="7" y1="12" x2="7" y2="12.01"/>
  <line x1="17" y1="12" x2="17" y2="12.01"/>
</svg>`,
      brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="5" fill="currentColor" fill-opacity="0.12"/>
  <circle cx="12" cy="12" r="2" fill="currentColor"/>
  <line x1="12" y1="2" x2="12" y2="5"/>
  <line x1="12" y1="19" x2="12" y2="22"/>
  <line x1="2" y1="12" x2="5" y2="12"/>
  <line x1="19" y1="12" x2="22" y2="12"/>
</svg>`,
      mode: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" fill-opacity="0.14"/>
</svg>`
    }
  },
  {
    id: "cyber-geometric",
    name: "Candidate 5: Cyber Geometric (Hex & Tech)",
    badge: "Cyberpunk & Hacker",
    tagline: "45-degree chamfers, hexagonal tech matrices, and telemetry styling.",
    description: "Designed for power users who love cyberdeck aesthetics and advanced developer cockpits. Features chamfered corners, precision bus traces, and diagnostic telemetry cues.",
    traits: ["45° Tech Chamfers", "Circuit & Bus Accents", "Hexagonal Symmetry", "Power User Vibe"],
    icons: {
      gpu: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="6 3 18 3 21 6 21 18 18 21 6 21 3 18 3 6"/>
  <rect x="8" y="8" width="8" height="8"/>
  <line x1="8" y1="12" x2="16" y2="12"/>
  <line x1="12" y1="8" x2="12" y2="16"/>
</svg>`,
      terminal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="4 4 17 4 20 7 20 20 4 20"/>
  <polyline points="8 9 12 12 8 15"/>
  <line x1="13" y1="15" x2="16" y2="15"/>
</svg>`,
      agent: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="12 2 21 7 21 17 12 22 3 17 3 7"/>
  <circle cx="12" cy="12" r="3"/>
  <line x1="12" y1="9" x2="12" y2="6"/>
</svg>`,
      ssh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="5 5 19 5 21 8 21 10 19 13 5 13 3 10 3 8"/>
  <polygon points="5 13 19 13 21 16 21 18 19 21 5 21 3 18 3 16"/>
  <line x1="7" y1="9" x2="10" y2="9"/>
  <line x1="7" y1="17" x2="10" y2="17"/>
</svg>`,
      browser: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="4 4 20 4 22 7 22 20 2 20 2 7"/>
  <line x1="2" y1="9" x2="22" y2="9"/>
  <line x1="6" y1="6.5" x2="8" y2="6.5"/>
</svg>`,
      editor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="4 2 15 2 20 7 20 22 4 22"/>
  <line x1="15" y1="2" x2="15" y2="7"/>
  <line x1="15" y1="7" x2="20" y2="7"/>
  <polyline points="9 13 7 15 9 17"/>
  <polyline points="13 13 15 15 13 17"/>
</svg>`,
      plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="5 3 19 3 21 6 21 21 5 21"/>
  <polyline points="8 12 11 15 17 9"/>
</svg>`,
      diff: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="3 4 10 4 11 7 11 20 3 20"/>
  <polygon points="13 4 20 4 21 7 21 20 13 20"/>
</svg>`,
      brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="12 2 18 5 21 11 18 19 12 22 6 19 3 11 6 5"/>
  <line x1="12" y1="6" x2="12" y2="18"/>
  <line x1="6" y1="12" x2="18" y2="12"/>
</svg>`,
      mode: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="14 2 4 13 11 13 10 22 20 11 13 11 14 2"/>
</svg>`
    }
  },
  {
    id: "micro-badge",
    name: "Candidate 6: Micro-Badge (Framed Squircle Glyphs)",
    badge: "Compact & Anchored",
    tagline: "Ultra-compact icons framed inside rounded square geometric badges.",
    description: "Solves the 'floating glyph' dilemma inside busy multi-pane layouts. Each icon is enclosed in a subtle perimeter frame or squircle badge, providing uniform visual mass across all tabs and buttons.",
    traits: ["Squircle Badge Framing", "Uniform Visual Mass", "Anchored Layout Presence", "Pixel-Perfect Tab Footprint"],
    icons: {
      gpu: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <rect x="8" y="8" width="8" height="8" rx="1.5"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>`,
      terminal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <polyline points="7 10 10 12 7 14"/>
  <line x1="12" y1="14" x2="16" y2="14"/>
</svg>`,
      agent: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <path d="M12 7l1.5 3.5L17 12l-3.5 1.5L12 17l-1.5-3.5L7 12l3.5-1.5L12 7z"/>
</svg>`,
      ssh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <circle cx="9" cy="12" r="2.5"/>
  <circle cx="15" cy="12" r="2.5"/>
  <line x1="11.5" y1="12" x2="12.5" y2="12"/>
</svg>`,
      browser: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <circle cx="12" cy="12" r="5"/>
  <line x1="7" y1="12" x2="17" y2="12"/>
  <path d="M12 7a8 8 0 0 1 0 10 8 8 0 0 1 0-10"/>
</svg>`,
      editor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <polyline points="9 9 7 12 9 15"/>
  <polyline points="15 9 17 12 15 15"/>
  <line x1="13" y1="8" x2="11" y2="16"/>
</svg>`,
      plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <polyline points="8 12 10.5 14.5 16 9.5"/>
</svg>`,
      diff: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <line x1="12" y1="6" x2="12" y2="18"/>
  <circle cx="8" cy="12" r="1.5" fill="currentColor"/>
  <circle cx="16" cy="12" r="1.5"/>
</svg>`,
      brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <circle cx="12" cy="12" r="3.5"/>
  <line x1="12" y1="6" x2="12" y2="8.5"/>
  <line x1="12" y1="15.5" x2="12" y2="18"/>
</svg>`,
      mode: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <polygon points="13 6 8 13 12 13 11 18 16 11 12 11 13 6"/>
</svg>`
    }
  },
  {
    id: "faceted-segmented",
    name: "Candidate 7: Faceted Segmented (Architectural Cuts)",
    badge: "Structural & Modern",
    tagline: "Architectural line breaks and segmented contours conveying modularity.",
    description: "Uses intentional micro-gaps and segmented paths that evoke modern engineering blueprints and structural drafting. Unmistakably sophisticated and distinctive.",
    traits: ["Segmented Path Cuts", "Drafting Blueprint Cues", "Distinctive Personality", "Precision Spatial Division"],
    icons: {
      gpu: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M7 4h10M4 7v10M20 7v10M7 20h10"/>
  <rect x="8" y="8" width="8" height="8" rx="1.5"/>
  <line x1="12" y1="2" x2="12" y2="4"/>
  <line x1="12" y1="20" x2="12" y2="22"/>
  <line x1="2" y1="12" x2="4" y2="12"/>
  <line x1="20" y1="12" x2="22" y2="12"/>
</svg>`,
      terminal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 8V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>
  <polyline points="7 10 10 12 7 14"/>
  <line x1="13" y1="14" x2="17" y2="14"/>
</svg>`,
      agent: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3v3m0 12v3M3 12h3m12 0h3"/>
  <circle cx="12" cy="12" r="5"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>`,
      ssh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 7h12M6 17h12"/>
  <circle cx="6" cy="7" r="2"/>
  <circle cx="18" cy="7" r="2"/>
  <circle cx="6" cy="17" r="2"/>
  <circle cx="18" cy="17" r="2"/>
</svg>`,
      browser: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3M3 12v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
  <line x1="3" y1="8" x2="21" y2="8"/>
  <line x1="7" y1="5.5" x2="9" y2="5.5"/>
</svg>`,
      editor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/>
  <polyline points="9 10 7 12 9 14"/>
  <polyline points="15 10 17 12 15 14"/>
</svg>`,
      plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 8V4h14v4M5 16v4h14v-4"/>
  <polyline points="8 12 10.5 14.5 16 9.5"/>
</svg>`,
      diff: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 5h5v14H4zM15 5h5v14h-5z"/>
  <line x1="11.5" y1="12" x2="12.5" y2="12"/>
</svg>`,
      brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 12a6 6 0 0 1 12 0M6 12a6 6 0 0 0 12 0"/>
  <line x1="12" y1="3" x2="12" y2="6"/>
  <line x1="12" y1="18" x2="12" y2="21"/>
</svg>`,
      mode: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M13 2L5 12h6M11 22l8-10h-6"/>
</svg>`
    }
  },
  {
    id: "pixel-matrix-hifi",
    name: "Candidate 8: Pixel Matrix (Hi-Fi Retro Console)",
    badge: "Retro-Modern",
    tagline: "Orthogonal pixel-grid vectors evoking telemetry monitors and game engines.",
    description: "Clean orthogonal vector steps inspired by old-school Unix workstation telemetry, rendered in razor-sharp scalable SVGs (not blurry bitmap PNGs). Brings subtle nostalgia with modern execution.",
    traits: ["Pure Orthogonal Vectors", "Zero Blurry Bitmaps", "Retro Unix Telemetry", "Playful Engineering Soul"],
    icons: {
      gpu: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="5" width="14" height="14"/>
  <rect x="9" y="9" width="6" height="6"/>
  <line x1="2" y1="8" x2="5" y2="8"/>
  <line x1="2" y1="16" x2="5" y2="16"/>
  <line x1="19" y1="8" x2="22" y2="8"/>
  <line x1="19" y1="16" x2="22" y2="16"/>
  <line x1="8" y1="2" x2="8" y2="5"/>
  <line x1="16" y1="2" x2="16" y2="5"/>
  <line x1="8" y1="19" x2="8" y2="22"/>
  <line x1="16" y1="19" x2="16" y2="22"/>
</svg>`,
      terminal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18"/>
  <polyline points="7 9 10 12 7 15"/>
  <line x1="12" y1="15" x2="17" y2="15"/>
</svg>`,
      agent: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="6" width="14" height="12"/>
  <rect x="8" y="10" width="2" height="2" fill="currentColor"/>
  <rect x="14" y="10" width="2" height="2" fill="currentColor"/>
  <line x1="12" y1="2" x2="12" y2="6"/>
  <line x1="9" y1="15" x2="15" y2="15"/>
</svg>`,
      ssh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="4" width="16" height="6"/>
  <rect x="4" y="14" width="16" height="6"/>
  <rect x="7" y="6.5" width="2" height="1" fill="currentColor"/>
  <rect x="7" y="16.5" width="2" height="1" fill="currentColor"/>
</svg>`,
      browser: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16"/>
  <line x1="3" y1="9" x2="21" y2="9"/>
  <rect x="6" y="6" width="2" height="1" fill="currentColor"/>
  <rect x="10" y="6" width="2" height="1" fill="currentColor"/>
</svg>`,
      editor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="3" width="16" height="18"/>
  <line x1="8" y1="8" x2="14" y2="8"/>
  <line x1="8" y1="12" x2="16" y2="12"/>
  <line x1="8" y1="16" x2="12" y2="16"/>
</svg>`,
      plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="4" width="16" height="16"/>
  <rect x="8" y="8" width="8" height="2"/>
  <rect x="8" y="12" width="6" height="2"/>
  <rect x="8" y="16" width="4" height="2"/>
</svg>`,
      diff: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="8" height="16"/>
  <rect x="13" y="4" width="8" height="16"/>
  <line x1="11" y1="12" x2="13" y2="12"/>
</svg>`,
      brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="4" width="16" height="16"/>
  <rect x="8" y="8" width="8" height="8"/>
</svg>`,
      mode: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="14 3 6 13 13 13 10 21 18 11 11 11 14 3"/>
</svg>`
    }
  },
  {
    id: "vibrant-accent-glow",
    name: "Candidate 9: Vibrant Accent Glow",
    badge: "Brand Identity",
    tagline: "Monochrome base with selective Meowtrix Indigo & Violet accent highlights.",
    description: "Features a monochromatic neutral slate structure with subtle vibrant accent nodes (using `var(--accent, #6366f1)`). Creates immediate brand recognition while remaining 100% vector and cleanly styled.",
    traits: ["Selective Accent Highlights", "Meowtrix Brand Harmony", "Dynamic Theme Awareness", "High Visual Charm"],
    icons: {
      gpu: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="5" width="14" height="14" rx="3"/>
  <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="var(--accent, #6366f1)" stroke-width="2"/>
  <circle cx="12" cy="12" r="1" fill="var(--accent, #6366f1)"/>
  <path d="M9 2v3m6-3v3m-6 14v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>
</svg>`,
      terminal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="4 17 10 12 4 7"/>
  <line x1="12" y1="17" x2="20" y2="17" stroke="var(--accent, #6366f1)" stroke-width="2.5"/>
</svg>`,
      agent: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2l2.4 5.6L20 10l-4.4 3.8L16.8 20 12 16.8 7.2 20l1.2-6.2L4 10l5.6-2.4L12 2z" stroke="var(--accent, #6366f1)" stroke-width="1.9"/>
  <circle cx="12" cy="11.5" r="1.5" fill="var(--accent, #6366f1)"/>
</svg>`,
      ssh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="6" rx="2"/>
  <rect x="3" y="14" width="18" height="6" rx="2"/>
  <circle cx="7" cy="7" r="1.5" fill="var(--accent, #6366f1)" stroke="none"/>
  <circle cx="7" cy="17" r="1.5" fill="var(--accent, #6366f1)" stroke="none"/>
  <path d="M13 7h4m-4 10h4"/>
</svg>`,
      browser: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="3"/>
  <line x1="3" y1="9" x2="21" y2="9"/>
  <circle cx="6.5" cy="6.5" r="1" fill="var(--accent, #6366f1)" stroke="none"/>
</svg>`,
      editor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="16 18 22 12 16 6"/>
  <polyline points="8 6 2 12 8 18"/>
  <line x1="14" y1="4" x2="10" y2="20" stroke="var(--accent, #6366f1)"/>
</svg>`,
      plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="4" width="16" height="16" rx="2.5"/>
  <polyline points="8 12 11 15 16 9" stroke="var(--accent, #6366f1)" stroke-width="2"/>
</svg>`,
      diff: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="6" cy="6" r="3"/>
  <circle cx="6" cy="18" r="3"/>
  <line x1="6" y1="9" x2="6" y2="15"/>
  <circle cx="18" cy="9" r="3" stroke="var(--accent, #6366f1)"/>
  <path d="M6 9a9 9 0 0 1 9-3h3" stroke="var(--accent, #6366f1)"/>
</svg>`,
      brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3" stroke="var(--accent, #6366f1)" fill="var(--accent, #6366f1)" fill-opacity="0.2"/>
  <circle cx="12" cy="4" r="1.5"/>
  <circle cx="19" cy="8" r="1.5"/>
  <circle cx="19" cy="16" r="1.5"/>
  <circle cx="12" cy="20" r="1.5"/>
  <circle cx="5" cy="16" r="1.5"/>
  <circle cx="5" cy="8" r="1.5"/>
  <line x1="12" y1="5.5" x2="12" y2="9"/>
  <line x1="17.5" y1="9" x2="14.5" y2="10.5"/>
  <line x1="17.5" y1="15" x2="14.5" y2="13.5"/>
  <line x1="12" y1="18.5" x2="12" y2="15"/>
  <line x1="6.5" y1="15" x2="9.5" y2="13.5"/>
  <line x1="6.5" y1="9" x2="9.5" y2="10.5"/>
</svg>`,
      mode: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--accent, #6366f1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
</svg>`
    }
  },
  {
    id: "aerospace-instrument",
    name: "Candidate 10: Aerospace Instrument Panel",
    badge: "Instrument Grade",
    tagline: "Fine-gauge instrument dial lines and telemetry crosshairs.",
    description: "Inspired by mission-critical aerospace cockpits and telemetry gauges. High precision tick marks, concentric rings, and hairline crosshairs convey uncompromising reliability.",
    traits: ["Concentric Gauge Rings", "Fine Telemetry Ticks", "Mission-Critical Vibe", "Aerospace Precision"],
    icons: {
      gpu: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <circle cx="12" cy="12" r="4"/>
  <line x1="12" y1="3" x2="12" y2="5"/>
  <line x1="12" y1="19" x2="12" y2="21"/>
  <line x1="3" y1="12" x2="5" y2="12"/>
  <line x1="19" y1="12" x2="21" y2="12"/>
</svg>`,
      terminal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z"/>
  <polyline points="8 10 11 12 8 14"/>
  <line x1="13" y1="14" x2="16" y2="14"/>
  <circle cx="17" cy="7" r="0.75" fill="currentColor"/>
</svg>`,
      agent: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="8"/>
  <line x1="12" y1="4" x2="12" y2="8"/>
  <line x1="12" y1="16" x2="12" y2="20"/>
  <circle cx="12" cy="12" r="2" fill="currentColor"/>
</svg>`,
      ssh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <circle cx="8" cy="12" r="2"/>
  <circle cx="16" cy="12" r="2"/>
  <line x1="10" y1="12" x2="14" y2="12"/>
</svg>`,
      browser: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <ellipse cx="12" cy="12" rx="4" ry="9"/>
  <line x1="3" y1="12" x2="21" y2="12"/>
</svg>`,
      editor: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="3" width="14" height="18" rx="2"/>
  <line x1="8" y1="7" x2="16" y2="7"/>
  <line x1="8" y1="11" x2="16" y2="11"/>
  <line x1="8" y1="15" x2="13" y2="15"/>
</svg>`,
      plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <polyline points="8 12 11 15 16 9"/>
</svg>`,
      diff: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="8" cy="12" r="5"/>
  <circle cx="16" cy="12" r="5"/>
</svg>`,
      brain: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <circle cx="12" cy="12" r="5"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>`,
      mode: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <polygon points="12 6 9 13 12 13 11 18 15 11 12 11 12 6"/>
</svg>`
    }
  }
];

window.INCONSISTENT_ICONS_METADATA = [
  {
    key: "gpu",
    label: "GPU Monitor Icon",
    currentEmoji: "🎮",
    currentLook: "Apple/OS 3D Gamepad Emoji (Video Game Controller)",
    location: "Toolbar (#btn-gpu) & Palette",
    issue: "Skeuomorphic colorful gamepad emoji that clashes with sleek 24x24 monochrome SVG toolbar icons (ports, fullscreen, split, broadcast)."
  },
  {
    key: "terminal",
    label: "Terminal Tab Icon",
    currentEmoji: "⬛",
    currentLook: "Black Square Block Emoji",
    location: "Tab bar header & New Tab modal",
    issue: "Solid black box that becomes completely invisible or looks like a rendering bug / dead pixel against dark slate and OLED jet black backgrounds."
  },
  {
    key: "agent",
    label: "AI Agent Tab Icon",
    currentEmoji: "🤖",
    currentLook: "Toy Robot Face Emoji",
    location: "Tab bar header, Cockpit banner & New Tab modal",
    issue: "Playful cartoonish emoji that clashes with the professional vibe of an advanced local LLM engineering tool."
  },
  {
    key: "ssh",
    label: "SSH Remote Tab Icon",
    currentEmoji: "🔗",
    currentLook: "Hyperlink Chain Emoji",
    location: "Tab bar header & New Tab modal",
    issue: "Generic link emoji looks like a web hyperlink rather than a secure terminal remote shell connection."
  },
  {
    key: "browser",
    label: "Browser Tab Icon",
    currentEmoji: "🌐",
    currentLook: "Bright Blue Globe Emoji",
    location: "Tab bar header & New Tab modal",
    issue: "Vibrant multi-colored emoji breaks the monochromatic theme of the tab bar."
  },
  {
    key: "editor",
    label: "Code Editor Tab Icon",
    currentEmoji: "📝",
    currentLook: "Yellow Pencil Memo Emoji",
    location: "Tab bar header & New Tab modal",
    issue: "Yellow notepad emoji looks like a scratchpad note rather than a Monaco/VSCode developer IDE tab."
  },
  {
    key: "plan",
    label: "Task Plan Icon",
    currentEmoji: "📋",
    currentLook: "Clipboard Emoji",
    location: "Agent cockpit plan header",
    issue: "Emoji clipboard icon used alongside code diffs."
  },
  {
    key: "diff",
    label: "Diffs & Changes Icon",
    currentEmoji: "📂",
    currentLook: "Open Folder Emoji",
    location: "Agent cockpit diffs header & Editor sidebar",
    issue: "Bright yellow folder emoji instead of a clean Git diff / branch icon."
  },
  {
    key: "brain",
    label: "Reasoning / Chain of Thought",
    currentEmoji: "🧠",
    currentLook: "Pink Brain Emoji",
    location: "Agent reasoning collapsible header",
    issue: "Bright pink anatomical brain emoji breaks dark theme immersion."
  },
  {
    key: "mode",
    label: "Autonomous Mode Icon",
    currentEmoji: "⚡",
    currentLook: "Yellow High Voltage Zap Emoji",
    location: "Agent cockpit autonomous mode toggle",
    issue: "Bright yellow zap emoji instead of theme-responsive vector bolt."
  }
];
