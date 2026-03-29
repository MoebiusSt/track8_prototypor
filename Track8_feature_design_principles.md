# 🎛️ Track8 Feature Design Principles

Track8 is a **recording instrument**.
Track8 does not try to be a DAW.

These principles guide how new features are evaluated and implemented.

---

## ⚡ Core Idea

Track8 should feel:

- **Immediate** – no waiting, no friction  
- **Obvious** – works without reading a manual  
- **Fast** – supports creative flow without interruption  
- **Intentional** – advanced features require deliberate action  

If a feature compromises any of these, it likely doesn’t belong in its current form.

---

## 🧱 Two Layers of Interaction

Track8 separates functionality into two clear layers:

### Primary (Core)
- Instant  
- Physical (buttons, encoders)  
- Always available  
- Used constantly during usage  

### Secondary (Expert)
- Accessed intentionally (e.g. touch interaction)  
- Slightly slower by design  
- Contextual  
- Cannot be triggered accidentally  

> The primary layer must never be compromised by adding complexity.

---

## ⚡ Core Actions

Core actions must be:

- **Single-step**  
- **Immediate**  
- **Predictable**  

### Examples
- Recording  
- Playback  
- Marker placement  
- Basic editing  

No menus. No hidden states. No delays.

A user with basic recording experience should be able to use Track8 **without instructions**.

---

## 🧠 Expert Features

Advanced functionality is welcome — but must follow strict rules:

- **Discoverable** (users can find it)  
- **Intentional** (requires a deliberate action)  
- **Non-disruptive** (does not interfere with core workflow)  

**Trade-off:**  
> It is acceptable for expert features to be slower if it prevents accidental use.

### Typical characteristics
- Touch interaction  
- Secondary screens  
- No direct hardware shortcut (in most cases)  

---

## 📍 Example: Marker System

Markers demonstrate this design clearly.

### Core
- Dedicated **Marker button**  
- Sets / removes markers instantly  
- Defines regions for editing  

Fast, simple, always available.

---

### Expert
- Name marker  
- Lock marker (prevent deletion)  

### Access
- Touch the marker → opens keyboard + lock toggle  

---

### Why

- No accidental renaming or locking  
- No additional button combinations  
- Clear separation between fast actions and advanced control  

---

## 🚫 What to Avoid

When proposing features, avoid:

- Menu-driven workflows for core tasks  
- Multi-step interactions for simple actions  
- Hidden modes or unclear states  
- Overloading buttons with multiple meanings  
- Features that interrupt recording flow  
- “DAW-like” complexity in the primary layer  

---

## ✅ What Makes a Good Feature

A feature fits Track8 if it:

- Feels **obvious** to use  
- Is **fast** in common scenarios  
- Keeps the core workflow **uninterrupted**  
- Places complexity in the **secondary layer**  
- Requires **intent** for advanced actions  

---

## 🧩 Guiding Question

When evaluating a feature, ask:

> Does this make Track8 faster and more intuitive — or more complex?

If it adds complexity, it must justify itself by staying out of the core workflow.

---

## 🎯 Goal

Track8 is designed to:

> Capture ideas quickly, without breaking creative flow.

Every feature should reinforce that.