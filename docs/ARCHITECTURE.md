# Track8 Prototypor - Architecture Design Document

## 1. Project Overview

Track8 Prototypor is a browser simulation of the "Track8" hardware multi-track recorder by Thingstone. The application replicates a certain user interface view, the MIDI notes editor and simulated the navigation there in. The view is currently nearly pixel perfect clone of the display on the device. The app currently focuses on testing and finding a solution for a very specific feature: making movement inside the grid based pianorole view of midi notes to SNAP onto Midi-Note positions so the user can traverse the grid more easily/quickly.

The app offers a way to switch different algorihtms for the SNAP Algorithms so the user can test which attempt at navigation feels logical and intuitive and flawless. 

In all cases, the User uses the four arrow keys. Up and down in order to move no notes higher or lower on the piano role (higher or lower pitches). Or Left and right in order to traverse therough notes over time. (Context: the Track8 feature two endless rotary encoders which are used as turn-left-and-right to effect left and right and up-and-down traversal in the grid. The X-axis is gridded in musical beats and the y-axis is gridded by the semitone steps of a keyboard). The app is ok to simulate this with the arrow keys.)

Problems so far have been that no approach offered a fully reversible and deterministic way to JUMP through the notes, as this is logically/mathematically not possible in a 2D Grid for all configuration of note positions, note relationships and note overlapp  as long as thenotes so are all handled as "Points".

We are going to test more features and more algorithms and new approaches to the problem of most quick/comfortable/intuite midi note traversal in this scrollable grid.

**Technology Stack:**
- Vite (build tool, fast HMR)
- React 18+ (component framework with hooks)
- TypeScript (type safety)
- CSS Grid/Flexbox (pixel-perfect layout)
- GitHub Actions (CI/CD deployment to GitHub Pages)