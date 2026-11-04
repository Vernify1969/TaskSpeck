export function join(...parts) {
  return parts.filter((part) => part != null && part !== '').join('/');
}
export function dirname(value) {
  const parts = String(value || '').split('/');
  parts.pop();
  return parts.join('/') || '.';
}
export default { join, dirname };
