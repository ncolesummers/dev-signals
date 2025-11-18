/**
 * Test setup file for Bun test runner
 * Configures DOM environment using happy-dom
 */

import { Window } from "happy-dom";

// Create a happy-dom window instance
const window = new Window();

// Assign DOM globals to the global object
// Note: Using 'as unknown as' pattern to bridge incompatible type systems.
// This is necessary because happy-dom's type definitions conflict with TypeScript's
// built-in DOM lib types and Next.js augmentations. The double assertion through
// 'unknown' is safer than 'as any' because it makes the type conversion explicit.
global.window = window as unknown as typeof globalThis.window;
global.document = window.document as unknown as typeof globalThis.document;
global.navigator = window.navigator as unknown as typeof globalThis.navigator;
global.HTMLElement =
  window.HTMLElement as unknown as typeof globalThis.HTMLElement;
global.Element = window.Element as unknown as typeof globalThis.Element;
global.Node = window.Node as unknown as typeof globalThis.Node;
global.DocumentFragment =
  window.DocumentFragment as unknown as typeof globalThis.DocumentFragment;

// Add missing Web APIs that PGlite needs
global.window.encodeURIComponent = encodeURIComponent;
global.window.decodeURIComponent = decodeURIComponent;
// Location type requires explicit unknown assertion due to string union in global type
(global.window as { location: unknown }).location = window.location;
