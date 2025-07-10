// Utility to fetch task definition JSON from GCS for a given taskId
export async function fetchTaskDefinitionFromGCS(taskId) {
    const url = `https://storage.googleapis.com/re_archaeology/tasks/${taskId}.json`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch task definition from GCS');
    return await resp.json();
}

// Centralized helpers for constructing GCS public URLs for all app assets
export function getGcsTileUrl(taskId, filename) {
    return `https://storage.googleapis.com/re_archaeology/tasks/${taskId}/tiles/${filename}`;
}

export function getGcsSnapshotUrl(taskId, levelIdx) {
    // Backend saves to: tasks/<taskId>/snapshots/level_<levelIdx>_color.png
    return `https://storage.googleapis.com/re_archaeology/tasks/${taskId}/snapshots/level_${levelIdx}_color.png`;
}

export function getGcsTaskProfileUrl(taskId) {
    return `https://storage.googleapis.com/re_archaeology/tasks/${taskId}.json`;
}

// Optionally: add more helpers for other GCS asset types as needed
