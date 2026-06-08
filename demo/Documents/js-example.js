function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatBytes(bytes) {
  const sizes = ["B", "KB", "MB", "GB"];
  let i = 0;

  while (bytes >= 1024 && i < sizes.length - 1) {
    bytes /= 1024;
    i++;
  }

  return `${bytes.toFixed(2)} ${sizes[i]}`;
}

const files = [
  { name: "photo.jpg", size: 1250000 },
  { name: "video.mp4", size: 84500000 },
  { name: "archive.zip", size: 540000 }
];

for (const file of files) {
  console.log(`${file.name} → ${formatBytes(file.size)}`);
}

console.log("Clamped value:", clamp(150, 0, 100));
