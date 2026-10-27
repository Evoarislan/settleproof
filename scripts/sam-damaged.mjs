import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const { samCount } = await import(process.cwd() + "/src/providers.js");
const b64 = readFileSync("test-assets/real-damaged.jpg").toString("base64");
const uri = `data:image/jpeg;base64,${b64}`;
const present = await samCount(uri, "white product box");
console.log("present (white product box):", present.count);
writeFileSync("/tmp/dmg-present.json", JSON.stringify(present.boxes));
for (const c of ["crushed box", "damaged box", "crushed damaged white box"]) {
  const r = await samCount(uri, c);
  console.log(`damaged concept ${JSON.stringify(c)}:`, r.count);
  if (c === "crushed box") writeFileSync("/tmp/dmg-damaged.json", JSON.stringify(r.boxes));
}
