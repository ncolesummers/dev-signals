/**
 * Test setup file for Bun test runner
 * Configures DOM environment using happy-dom
 */

import { Window } from "happy-dom";

// Create a happy-dom window instance
const window = new Window();

// Assign DOM globals to the global object
// Note: Using 'as any' to avoid type conflicts between happy-dom and Next.js Window types
global.window = window as any;
global.document = window.document as any;
global.navigator = window.navigator as any;
global.HTMLElement = window.HTMLElement as any;
global.Element = window.Element as any;
global.Node = window.Node as any;
global.DocumentFragment = window.DocumentFragment as any;

// Add missing Web APIs that PGlite needs
global.window.encodeURIComponent = encodeURIComponent;
global.window.decodeURIComponent = decodeURIComponent;
global.window.location = window.location as any;
