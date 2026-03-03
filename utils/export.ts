import { LabelMap } from '../types';

/**
 * Exports the label map to .txt files in a user-selected directory.
 * Format: <class_id> <cx> <cy> <w> <h>
 */
export const exportLabels = async (labelMap: LabelMap) => {
    try {
        // @ts-ignore
        const dirHandle = await window.showDirectoryPicker();

        for (const [filename, boxes] of Object.entries(labelMap)) {
            // Convert boxes to string format
            const lines = boxes.map(box => {
                return `${box.classId} ${box.x.toFixed(6)} ${box.y.toFixed(6)} ${box.w.toFixed(6)} ${box.h.toFixed(6)}`;
            });
            const content = lines.join('\n');

            // Create or get the file handle
            // @ts-ignore
            const fileHandle = await dirHandle.getFileHandle(filename, { create: true });

            // Create a writable stream and write to it
            // @ts-ignore
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
        }
    } catch (err) {
        console.error("Export cancelled or failed:", err);
        throw err;
    }
};
