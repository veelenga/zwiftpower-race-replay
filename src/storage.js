import { STORAGE_KEY_RACES } from './constants.js';

/**
 * Storage manager for synced race data
 */
export const RaceStorage = {
  /**
   * Get all synced races
   * @returns {Promise<Object>} Map of eventId -> race data
   */
  async getAll() {
    const result = await chrome.storage.local.get(STORAGE_KEY_RACES);
    return result[STORAGE_KEY_RACES] || {};
  },

  /**
   * Get a specific race by event ID
   * @param {string} eventId
   * @returns {Promise<Object|null>}
   */
  async get(eventId) {
    const races = await this.getAll();
    return races[eventId] || null;
  },

  /**
   * Save race data
   * @param {string} eventId
   * @param {Object} raceData
   */
  async save(eventId, raceData) {
    const races = await this.getAll();
    races[eventId] = {
      ...raceData,
      syncedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ [STORAGE_KEY_RACES]: races });
  },

  /**
   * Delete a synced race
   * @param {string} eventId
   */
  async delete(eventId) {
    const races = await this.getAll();
    delete races[eventId];
    await chrome.storage.local.set({ [STORAGE_KEY_RACES]: races });
  },

  /**
   * Get list of synced races with metadata
   * @returns {Promise<Array>}
   */
  async getList() {
    const races = await this.getAll();
    return Object.entries(races).map(([eventId, data]) => ({
      eventId,
      name: data.eventName || `Race ${eventId}`,
      syncedAt: data.syncedAt,
      riderCount: data.riders?.length || 0,
    }));
  },
};
