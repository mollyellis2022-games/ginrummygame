// server/rooms.js
/**
 * In-memory room registry.
 *
 * Notes:
 * - This is intentionally simple: a process-local Map.
 * - Restarting the server wipes all rooms (no persistence).
 * - Room objects are created by `makeRoom()` in your server file and stored here.
 *
 * Key:
 * - `code` (string): normalized room code (your server uppercases + trims it).
 *
 * Value:
 * - `room` (object): contains sockets[], game state, and helper methods (sendState, startRound, etc.)
 */

const rooms = new Map(); // code -> room

/**
 * Returns the room for a given code, or undefined if missing.
 */
function getRoom(code) {
  return rooms.get(code);
}

/**
 * True if a room exists for the given code.
 */
function hasRoom(code) {
  return rooms.has(code);
}

/**
 * Adds/replaces a room under the given code.
 * Caller is responsible for ensuring code normalization.
 */
function setRoom(code, room) {
  rooms.set(code, room);
}

/**
 * Removes a room from the registry.
 * Safe to call even if it doesn't exist.
 */
function deleteRoom(code) {
  rooms.delete(code);
}

/**
 * Returns the backing Map for debugging / admin tooling.
 * Be careful: callers can mutate the map.
 */
function allRooms() {
  return rooms;
}

module.exports = {
  getRoom,
  hasRoom,
  setRoom,
  deleteRoom,
  allRooms,
};
