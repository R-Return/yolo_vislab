import { openDB, DBSchema } from 'idb';
import { BoundingBox } from '../types';

interface VislabDB extends DBSchema {
    labels: {
        key: string;
        value: {
            filename: string;
            boxes: BoundingBox[];
            timestamp: number;
        };
    };
}

const DB_NAME = 'yolo-vislab-db';
const STORE_NAME = 'labels';

export const getDB = async () => {
    return await openDB<VislabDB>(DB_NAME, 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'filename' });
            }
        },
    });
};

export const saveLabelToDB = async (filename: string, boxes: BoundingBox[]) => {
    const db = await getDB();
    await db.put(STORE_NAME, {
        filename,
        boxes,
        timestamp: Date.now(),
    });
};

export const getAllSavedLabels = async () => {
    const db = await getDB();
    return await db.getAll(STORE_NAME);
};

export const deleteLabelFromDB = async (filename: string) => {
    const db = await getDB();
    await db.delete(STORE_NAME, filename);
};

export const clearAllLabelsFromDB = async () => {
    const db = await getDB();
    await db.clear(STORE_NAME);
};
