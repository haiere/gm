/* Utilitas kecil yang dipakai main.js */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}
