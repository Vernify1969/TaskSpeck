function noop() {}
const fs = {
  existsSync: () => false,
  readFileSync: () => { throw new Error('Files are not used in the phone demo'); },
  writeFileSync: noop,
  mkdirSync: noop,
  appendFileSync: noop,
};
export const existsSync = fs.existsSync;
export const readFileSync = fs.readFileSync;
export const writeFileSync = fs.writeFileSync;
export const mkdirSync = fs.mkdirSync;
export const appendFileSync = fs.appendFileSync;
export default fs;
