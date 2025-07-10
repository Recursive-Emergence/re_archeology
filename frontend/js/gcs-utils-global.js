// gcs-utils-global.js
// Makes fetchTaskDefinitionFromGCS and GCS URL helpers available globally for non-module scripts

import { getGcsTileUrl, getGcsSnapshotUrl, getGcsTaskProfileUrl } from './gcs-utils.js';

window.fetchTaskDefinitionFromGCS = async function(taskId) {
    const url = `https://storage.googleapis.com/re_archaeology/tasks/${taskId}.json`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch task definition from GCS');
    return await resp.json();
};

window.getGcsTileUrl = getGcsTileUrl;
window.getGcsSnapshotUrl = getGcsSnapshotUrl;
window.getGcsTaskProfileUrl = getGcsTaskProfileUrl;
