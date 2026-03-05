import { LabelMap } from '../types';

import JSZip from 'jszip';

/**
 * Exports the label map to .txt files in a user-selected directory.
 * Format: <class_id> <cx> <cy> <w> <h>
 */
export const exportLabels = async (labelMap: LabelMap, onProgress?: (current: number, total: number) => void) => {
    try {
        // @ts-ignore
        const dirHandle = await window.showDirectoryPicker();

        const entries = Object.entries(labelMap);
        const total = entries.length;
        let current = 0;

        if (onProgress) onProgress(current, total);

        for (const [filename, boxes] of entries) {
            // Convert boxes to string format
            const lines = boxes.map(box => {
                return `${box.classId} ${box.x.toFixed(6)} ${box.y.toFixed(6)} ${box.w.toFixed(6)} ${box.h.toFixed(6)}`;
            });
            const content = lines.join('\n');

            let success = false;
            let attempts = 0;
            const maxAttempts = 3;

            while (!success && attempts < maxAttempts) {
                try {
                    // Create or get the file handle
                    // @ts-ignore
                    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });

                    // Create a writable stream and write to it
                    // @ts-ignore
                    const writable = await fileHandle.createWritable();
                    await writable.write(content);
                    await writable.close();
                    success = true;

                    current++;
                    if (onProgress) onProgress(current, total);

                    // Add a small delay to prevent the browser from throttling or dropping file writes
                    // when saving a large number of files sequentially.
                    await new Promise(resolve => setTimeout(resolve, 10));
                } catch (writeErr) {
                    attempts++;
                    console.warn(`Failed to write ${filename} (attempt ${attempts}/${maxAttempts}):`, writeErr);
                    if (attempts >= maxAttempts) {
                        throw writeErr; // Bubble up if we exhausted retries
                    }
                    // Exponential backoff before retrying
                    await new Promise(resolve => setTimeout(resolve, 200 * attempts));
                }
            }
        }
    } catch (err) {
        console.error("Export cancelled or failed:", err);
        throw err;
    }
};

/**
 * Fallback to export the label map as a single .zip file.
 * Format: <class_id> <cx> <cy> <w> <h>
 */
export const exportLabelsAsZip = async (labelMap: LabelMap, onProgress?: (current: number, total: number) => void) => {
    try {
        const zip = new JSZip();
        const entries = Object.entries(labelMap);
        const total = entries.length;
        let current = 0;

        if (onProgress) onProgress(current, total);

        // Add all files to the zip bundle
        for (const [filename, boxes] of entries) {
            const lines = boxes.map(box => {
                return `${box.classId} ${box.x.toFixed(6)} ${box.y.toFixed(6)} ${box.w.toFixed(6)} ${box.h.toFixed(6)}`;
            });
            const content = lines.join('\n');
            zip.file(filename, content);

            current++;
            if (onProgress) onProgress(current, total);
        }

        // Generate the zip blob
        const blob = await zip.generateAsync({ type: "blob" });

        // Trigger download
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `yolo_labels_export_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
        document.body.appendChild(a);
        a.click();

        // Cleanup
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);

    } catch (err) {
        console.error("Zip Export failed:", err);
        throw err;
    }
};
