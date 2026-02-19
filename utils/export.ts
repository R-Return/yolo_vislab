import JSZip from 'jszip';
import { LabelMap } from '../types';

/**
 * Exports the label map to a ZIP file containing .txt files.
 * Format: <class_id> <cx> <cy> <w> <h>
 */
export const exportLabels = async (labelMap: LabelMap, fileName: string = 'annotations.zip') => {
    const zip = new JSZip();

    Object.entries(labelMap).forEach(([filename, boxes]) => {
        // Convert boxes to string format
        const lines = boxes.map(box => {
            // Ensure we only export what is needed for training (class x y w h)
            // If confidence exists, it might be a prediction, but for GT export we usually omit it or include it.
            // User said: "download the modifiied labels which can be used to train" -> Training usually needs class x y w h
            return `${box.classId} ${box.x.toFixed(6)} ${box.y.toFixed(6)} ${box.w.toFixed(6)} ${box.h.toFixed(6)}`;
        });

        const content = lines.join('\n');
        zip.file(filename, content);
    });

    const blob = await zip.generateAsync({ type: 'blob' });

    // Trigger download
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
