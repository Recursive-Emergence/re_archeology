// Entry point for RE-Archaeology App
import { REArchaeologyApp } from './app-core.js';

// Silence all Logger output for clean UI
if (window.Logger) window.Logger.setLevel('SILENT');

window.addEventListener('DOMContentLoaded', () => {
    window.reArchaeologyApp = new REArchaeologyApp();
    window.reArchaeologyApp.init();
});
