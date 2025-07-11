// Entry point for RE-Archaeology App
import { REArchaeologyApp } from './app-core.js';

// Enable debug logging temporarily
if (window.Logger) window.Logger.setLevel('DEBUG');

window.addEventListener('DOMContentLoaded', () => {
    window.reArchaeologyApp = new REArchaeologyApp();
    window.reArchaeologyApp.init();
});
