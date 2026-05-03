## Overview

ScreenMate is a premium, modern WebRTC-based screen and media sharing application. Its design language is a masterclass in **glassmorphism, subtle micro-interactions, and meticulously balanced dark mode aesthetics**. Every surface feels tangible, layered, and responsive. Rather than relying on flat colors, the UI leverages translucent backgrounds, precise border radii, and soft shadows to create a sense of depth and hierarchy.

The application exists in several contexts—browser extension popups, floating content overlays, and a standalone web viewer—yet maintains a unified visual identity. Density is balanced to allow content to breathe, while interactive elements are distinct and inviting.

**Key Characteristics:**
- **Dynamic Glassmorphism**: Heavy use of `backdrop-blur` coupled with low-opacity backgrounds (`bg-white/10`, `bg-zinc-950/20`) to create frosted glass effects that adapt beautifully to any underlying content.
- **Micro-interactions**: Buttons and cards feel alive. Hover states trigger slight scaling (`hover:scale-105`), gentle translations (`hover:-translate-y-1`), and active states compress (`active:scale-95`) to provide immediate, satisfying tactile feedback.
- **Sophisticated Dark Mode**: Dark mode avoids eye-straining pure blacks (`#000000`). Instead, it uses a carefully layered palette of Zinc (`zinc-950` for the deepest backgrounds, `zinc-900` for cards, `zinc-800` for elevated elements).
- **Subtle Glows and Shadows**: Focus and active states often use colored glows (e.g., Emerald or Blue) rather than harsh outlines, giving the UI a futuristic, polished feel.
- **Consistent Rounded Geometry**: Interfaces rely on friendly, generous border radii (`rounded-xl`, `rounded-2xl`, `rounded-[24px]`) to soften the technology and make it feel approachable.

## Colors

### Brand & Accent
- **Action Blue** (`blue-600` / `blue-500`): The primary accent color for active states, primary buttons, and loading spinners. In dark mode, it shifts slightly to `blue-400` for better contrast.
- **Success Emerald** (`emerald-500` / `emerald-400`): Used to indicate positive, "live," or successfully saved states. Often applied with low-opacity backgrounds (`bg-emerald-500/10`) to create a subtle glow rather than a stark solid block.
- **Destructive Red** (`red-600` / `red-400`): Used for stopping shares or disconnecting. Applied with a tinted background (`bg-red-50`) to keep the warning clear but visually integrated.

### Surface (Light Mode)
- **Canvas** (`zinc-50` / `zinc-100`): The deepest background layer.
- **Cards** (`white`): Elevated surfaces sit on pure white to pop against the slightly off-white canvas.
- **Glass** (`bg-white/50` to `bg-white/90`): Used heavily for overlays and sticky headers to allow background content to peek through softly.

### Surface (Dark Mode)
- **Deep Void** (`black` or `zinc-950`): The absolute bottom layer of the application (e.g., the outer padding of the viewer).
- **Base Card** (`zinc-900`): The primary surface color for main containers and dialogs. It provides enough contrast against the void without being too bright.
- **Elevated Card** (`zinc-800`): Used for elements that sit on top of the base card, such as chat bubbles, input fields, or secondary panels.
- **Dark Glass** (`bg-zinc-950/40` or `bg-black/50`): Used for floating overlays, player controls, and sticky headers.

### Text & Borders
- **Primary Text**: `text-foreground` (near black in light, near white in dark).
- **Muted Text**: `text-muted-foreground` for secondary information, timestamps, and captions.
- **Borders**: Highly subtle. Instead of solid lines, we use low-opacity borders (`border-border/50`, `border-white/10`) to define edges without adding visual noise.

## Typography

### Font Family
- **Base**: `Inter, system-ui, -apple-system, sans-serif`. A clean, highly legible neo-grotesque sans-serif that looks exceptional on high-density displays.

### Hierarchy & Principles
- **Headlines**: Set in `font-bold` or `font-black` with tight tracking (`tracking-tight`). Large, confident, and often paired with subtle text shadows (`drop-shadow-sm`) when placed over images or video.
- **Body**: Set in `text-sm` (14px) or `text-xs` (12px). We favor slightly smaller, crisper text for utility UIs to maximize space while retaining a "pro-tool" feel.
- **Monospace**: `font-mono` is used selectively for technical data like Room IDs, file sizes, and bitrates to provide a structural, engineered contrast to the main UI.
- **All Caps**: Small, bold, uppercase tracking (`uppercase tracking-wider text-[10px]`) is used for micro-labels and badges (e.g., "LIVE", "ROOM ID").

## Elevation & Depth

ScreenMate does not rely on flat design; it is deeply layered.

| Level | Treatment | Use |
|---|---|---|
| Level 0 | Flat, `bg-zinc-50` or `dark:bg-black` | Outermost app wrapper |
| Level 1 | `shadow-sm`, `border-border/50` | Basic cards, input fields, chat bubbles |
| Level 2 | `shadow-md`, `backdrop-blur-md` | Sticky headers, primary action buttons |
| Level 3 | `shadow-xl` or `shadow-2xl`, `backdrop-blur-xl` | Floating dialogs, video player overlays, popovers |
| Glow | `shadow-[0_0_15px_rgba(...)]` | Active recording indicators, "Live" status badges |

## Shapes

- **Base Radius**: `rounded-lg` (8px) for small interactive elements like compact buttons and inputs.
- **Card Radius**: `rounded-xl` (12px) to `rounded-2xl` (16px) for standard panels, preview cards, and chat bubbles.
- **Dialog Radius**: `rounded-[24px]` for large, central modal dialogs to make them feel friendly and modern.
- **Full Radius**: `rounded-full` for avatars, small icon buttons, and floating action buttons.

## Components

### Buttons
- **Primary Action (Glass)**: The premium CTA. `bg-white/10 backdrop-blur-md border border-white/20 text-white`. Used on top of media or dark backgrounds.
- **Primary Action (Solid)**: `bg-foreground text-background`. A high-contrast, confident button used in standard forms (like "Join Room").
- **Secondary/Neutral**: `bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`. Used for "Save" or "Cancel" actions where we want to reduce visual noise.
- **Micro-interactions**: ALL buttons must have `transition-all duration-300 hover:scale-[1.02] active:scale-95`. This tactile feedback is the heartbeat of ScreenMate's UX.

### Dialogs & Overlays
- **Floating Overlay**: Used in the content script for video selection. A sharp `3px solid emerald-500` border with a `bg-emerald-500/15` tinted background, topped with a `backdrop-blur-md` floating badge containing a pulsing green indicator.
- **Modal Dialog**: Used for "Join Room". Enormous soft shadow (`shadow-2xl`), deep rounding (`rounded-[24px]`), and a frosted glass background (`bg-background/95 backdrop-blur-xl`).

### Chat Panel
- **Hierarchy**: The chat container uses a muted background (`dark:bg-zinc-950/20`).
- **Bubbles**: "Other" messages are `dark:bg-zinc-800`, while "My" messages use WeChat-inspired green (`dark:bg-[#26b553]`).
- **Inputs**: Floating input bar resting at the bottom `absolute bottom-4`, wrapped in a heavily rounded glass pill (`rounded-full backdrop-blur-md`).

## Do's and Don'ts

### Do
- **Do use glassmorphism**: Combine `bg-white/10` (or `bg-black/50`), `backdrop-blur-md`, and `border-white/20` for elements floating over video or complex backgrounds.
- **Do implement tactile scaling**: Always add `hover:scale-105 active:scale-95` to buttons and clickable cards.
- **Do layer dark mode correctly**: Background = `black` -> Main Card = `zinc-900` -> Elevated element = `zinc-800`.
- **Do use subtle glows**: Use `shadow-[0_0_10px_rgba(...)]` to indicate active or "Live" states rather than relying solely on borders.
- **Do truncate long text**: Always use `truncate` on file names and URLs to prevent layout breaking.

### Don't
- **Don't use pure black inside cards**: `bg-black` is only for the absolute deepest background layer or video player canvases. Never use it for a card or chat bubble.
- **Don't use harsh, solid borders**: Avoid `border-black` or `border-white`. Always use fractional opacity like `border-border/50` or `border-white/10`.
- **Don't use cheap CSS gradients on primary UI**: Avoid default linear gradients on buttons (e.g., `from-teal-500 to-cyan-600`) unless explicitly designed for a specific marketing banner. Prefer solid foreground colors or subtle glass textures.
- **Don't forget transitions**: Never change a color or transform a scale without `transition-all duration-300`. State changes must glide, not snap.

## Iteration Guide

1. **Check the Background Context**: Are you placing this over a video/image? Use glassmorphism (`backdrop-blur`). Are you placing this on a standard page? Use standard zinc colors.
2. **Nail the Hover State**: What happens when the mouse enters? Add a subtle lift (`-translate-y-[1px]`), a scale (`scale-[1.02]`), and a slight shadow boost.
3. **Refine Dark Mode**: Flip to dark mode. If the element looks like a "black hole," its `zinc` value is too low. Bump it from 950 to 900 or 800.
4. **Clean up the Borders**: If a border looks too sharp, drop its opacity. A border should define an edge, not draw a line.
