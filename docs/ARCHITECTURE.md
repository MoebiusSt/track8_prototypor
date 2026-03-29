# Track8 Prototypor - Architecture Design Document

## 1. Project Overview

Track8 Prototypor is a pixel-perfect browser simulation of the "Track8" hardware multi-track recorder by Thingstone. The application replicates the device's physical interface, input system, and core workflows in a web environment, enabling users to interact with the device's logic and design through their desktop keyboard and mouse.

**Core Design Philosophy:**
- **Primary Layer:** Instant, physical, always available (transport controls, track selection, main navigation)
- **Secondary Layer:** Intentional, contextual, slightly slower (settings, utility functions)
- **Core Actions:** Single-step, immediate, predictable

**Technology Stack:**
- Vite (build tool, fast HMR)
- React 18+ (component framework with hooks)
- TypeScript (type safety)
- CSS Grid/Flexbox (pixel-perfect layout)
- GitHub Actions (CI/CD deployment to GitHub Pages)