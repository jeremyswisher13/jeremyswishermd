import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, ".."));
const htmlFiles = [];

function collectHtmlFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectHtmlFiles(fullPath);
    } else if (entry.name.endsWith(".html")) {
      htmlFiles.push(fullPath);
    }
  }
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];

  const nestedGraph = Array.isArray(value["@graph"])
    ? value["@graph"].flatMap(flattenJsonLd)
    : [];

  return [value, ...nestedGraph];
}

function hasType(node, expectedType) {
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return types.includes(expectedType);
}

function normalizeVisibleText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;|&#38;|&#x26;/gi, "&")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&lt;|&#60;|&#x3c;/gi, "<")
    .replace(/&gt;|&#62;|&#x3e;/gi, ">")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

const fullIsoDateTime =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const errors = [];
let jsonLdBlockCount = 0;
let profilePageCount = 0;

collectHtmlFiles(root);

for (const file of htmlFiles) {
  const relativePath = path.relative(root, file);
  const html = fs.readFileSync(file, "utf8");
  const visibleFaqs = new Map(
    [...html.matchAll(/<details class="faq-item"[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/gi)]
      .map((match) => [normalizeVisibleText(match[1]), normalizeVisibleText(match[2])]),
  );
  const pageModifiedMeta = html.match(
    /<meta\b[^>]*property=(['"])article:modified_time\1[^>]*content=(['"])([^'"]+)\2[^>]*>/i,
  )?.[3];
  const blocks = html.matchAll(
    /<script\b[^>]*type=(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const [, , source] of blocks) {
    jsonLdBlockCount += 1;

    let data;
    try {
      data = JSON.parse(source);
    } catch (error) {
      errors.push(`${relativePath}: invalid JSON-LD: ${error.message}`);
      continue;
    }

    const nodes = flattenJsonLd(data);
    const pageNodeModifiedDates = nodes
      .filter((node) => (
        hasType(node, "MedicalWebPage")
        || hasType(node, "WebPage")
        || hasType(node, "ProfilePage")
      ))
      .map((node) => node.dateModified)
      .filter((value) => typeof value === "string");

    if (
      pageModifiedMeta
      && pageNodeModifiedDates.length > 0
      && pageNodeModifiedDates.some((value) => value.slice(0, 10) !== pageModifiedMeta.slice(0, 10))
    ) {
      errors.push(
        `${relativePath}: article:modified_time does not match page-level JSON-LD dateModified`,
      );
    }

    for (const node of nodes) {
      if (hasType(node, "FAQPage")) {
        const questions = Array.isArray(node.mainEntity) ? node.mainEntity : [];
        for (const question of questions) {
          const questionText = normalizeVisibleText(question?.name);
          const answerText = normalizeVisibleText(question?.acceptedAnswer?.text);
          const visibleAnswer = visibleFaqs.get(questionText);
          if (visibleAnswer === undefined) {
            errors.push(`${relativePath}: JSON-LD FAQ question is not present in the visible FAQs: ${questionText}`);
          } else if (visibleAnswer !== answerText) {
            errors.push(`${relativePath}: JSON-LD FAQ answer does not match the visible answer: ${questionText}`);
          }
        }
      }

      if (!hasType(node, "ProfilePage")) continue;

      profilePageCount += 1;
      if (
        typeof node.dateModified !== "string" ||
        !fullIsoDateTime.test(node.dateModified)
      ) {
        errors.push(
          `${relativePath}: ProfilePage dateModified must be a full ISO 8601 DateTime with a timezone offset`,
        );
      }
    }
  }
}

if (profilePageCount === 0) {
  errors.push("No ProfilePage structured-data node was found");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${jsonLdBlockCount} JSON-LD blocks across ${htmlFiles.length} HTML files, including ${profilePageCount} ProfilePage node.`,
  );
}
