/**
 * Headless-Chromium form driver.
 *
 * It reads an application form generically - every visible input, select,
 * textarea, radio group and file input, with the human-readable label next to
 * it - rather than hard-coding one ATS's markup. Greenhouse and Lever forms are
 * plain server-rendered HTML, which is why they are the boards auto-apply is
 * enabled for.
 *
 * Only this file imports playwright-core, and only lazily, so the web app
 * builds and runs without a browser installed; auto-apply simply reports that
 * it is unavailable.
 */

import type { Browser, Page } from "playwright-core";
import type { FieldValue, ScrapedField } from "./fields";

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface SubmitOutcome {
  ok: boolean;
  message: string;
}

/** The operations the submitter needs from a browser. Faked in tests. */
export interface FormDriver {
  open(url: string): Promise<void>;
  scrape(): Promise<ScrapedField[]>;
  fill(values: Map<string, FieldValue>, files: Record<"resume" | "cover_letter", UploadFile | null>): Promise<void>;
  /** A CAPTCHA the user has to solve by hand, or null. */
  blockingCaptcha(): Promise<string | null>;
  submit(): Promise<SubmitOutcome>;
  close(): Promise<void>;
}

export class BrowserUnavailableError extends Error {}

/** Scraped field plus how to find it again. Never leaves this module. */
interface PageField extends ScrapedField {
  selector: string;
  /** For radio groups: option label -> selector of that radio button. */
  optionSelectors?: Record<string, string>;
}

const NAVIGATION_TIMEOUT_MS = 45_000;
const CONFIRMATION_TIMEOUT_MS = 25_000;
const SUCCESS_TEXT =
  /thank(s| you) for (applying|your (application|interest))|application (was |has been )?(submitted|received)|we('ve| have) received your application/i;

/**
 * Runs in the page. Must be self-contained: it is serialised and evaluated by
 * the browser, so it cannot reference anything from this module.
 */
function scrapeInPage(): PageField[] {
  const fields: PageField[] = [];
  const seenRadioGroups = new Set<string>();

  const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const selectorFor = (el: Element): string => {
    const id = el.getAttribute("id");
    if (id) return `#${CSS.escape(id)}`;
    const name = el.getAttribute("name");
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    // Last resort: a positional path from the form.
    const path: string[] = [];
    let node: Element | null = el;
    while (node && node.tagName !== "BODY") {
      const parent: Element | null = node.parentElement;
      const index = parent ? Array.from(parent.children).indexOf(node) + 1 : 1;
      path.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = parent;
    }
    return `body > ${path.join(" > ")}`;
  };
  const labelFor = (el: HTMLElement): string => {
    const id = el.getAttribute("id");
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label) return clean(label.textContent);
    }
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((ref) => clean(document.getElementById(ref)?.textContent))
        .join(" ");
      if (text) return text;
    }
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const wrapping = el.closest("label");
    if (wrapping) return clean(wrapping.textContent);
    // Lever and Greenhouse wrap each question in a container whose first
    // text node is the question.
    const container = el.closest(".application-question, .field, li, fieldset, .form-group, [class*='question']");
    const heading = container?.querySelector("legend, label, .application-label, .text, h3, h4");
    if (heading) return clean(heading.textContent);
    return clean(el.getAttribute("placeholder") ?? el.getAttribute("name"));
  };
  const isRequired = (el: HTMLElement, label: string) =>
    (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true" || /\*\s*$|\*\s*\(|✱/.test(label);

  const controls = document.querySelectorAll<HTMLElement>("form input, form textarea, form select");
  for (const el of Array.from(controls)) {
    if (el.closest(".g-recaptcha, .h-captcha, [class*='captcha']")) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? (tag === "input" ? "text" : tag)).toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "search"].includes(type)) continue;
    if ((el as HTMLInputElement).disabled) continue;
    if (type !== "file" && !visible(el)) continue;

    if (type === "radio") {
      const name = el.getAttribute("name") ?? "";
      if (!name || seenRadioGroups.has(name)) continue;
      seenRadioGroups.add(name);
      const radios = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
      );
      const optionSelectors: Record<string, string> = {};
      for (const radio of radios) {
        const text =
          clean(radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)?.textContent : "") ||
          clean(radio.closest("label")?.textContent) ||
          radio.value;
        optionSelectors[text] = radio.id
          ? `#${CSS.escape(radio.id)}`
          : `input[type="radio"][name="${CSS.escape(name)}"][value="${CSS.escape(radio.value)}"]`;
      }
      const group = el.closest("fieldset, .application-question, .field, li, [role='radiogroup']");
      const label = clean(group?.querySelector("legend, .application-label, label, .text")?.textContent) || name;
      fields.push({
        key: `radio:${name}`,
        label,
        kind: "radio",
        options: Object.keys(optionSelectors),
        required: radios.some((radio) => radio.required) || /\*/.test(label),
        isFile: false,
        selector: selectorFor(el),
        optionSelectors,
      });
      continue;
    }

    const label = labelFor(el);
    const key = el.getAttribute("name") || el.getAttribute("id") || selectorFor(el);
    const base = { key, label, required: isRequired(el, label), selector: selectorFor(el) };

    if (type === "file") {
      const text = `${label} ${key}`.toLowerCase();
      fields.push({
        ...base,
        kind: "text",
        options: [],
        isFile: true,
        fileKind: /cover/.test(text) ? "cover_letter" : /resume|cv|curriculum/.test(text) ? "resume" : "other",
      });
    } else if (tag === "select") {
      const options = Array.from((el as HTMLSelectElement).options)
        .filter((option) => option.value !== "" && !/^(select|choose|please select|--)/i.test(clean(option.text)))
        .map((option) => clean(option.text));
      fields.push({ ...base, kind: "select", options, isFile: false });
    } else if (type === "checkbox") {
      fields.push({ ...base, kind: "checkbox", options: [], isFile: false });
    } else {
      fields.push({ ...base, kind: tag === "textarea" ? "textarea" : "text", options: [], isFile: false });
    }
  }

  // Keys must be unique for answers to be routed back to the right field.
  const counts = new Map<string, number>();
  return fields.map((field) => {
    const seen = counts.get(field.key) ?? 0;
    counts.set(field.key, seen + 1);
    return seen === 0 ? field : { ...field, key: `${field.key}#${seen + 1}` };
  });
}

class PlaywrightDriver implements FormDriver {
  private fields = new Map<string, PageField>();

  constructor(
    private readonly browser: Browser,
    private readonly page: Page,
  ) {}

  async open(url: string) {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await this.page.waitForSelector("form", { timeout: NAVIGATION_TIMEOUT_MS });
    // Let client-side scripts attach custom questions.
    await this.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  }

  async scrape(): Promise<ScrapedField[]> {
    const fields = await this.page.evaluate(scrapeInPage);
    this.fields = new Map(fields.map((field) => [field.key, field]));
    // Selectors stay private to the driver; callers address fields by key.
    return fields.map((field) => {
      const { selector, optionSelectors, ...rest } = field;
      void selector;
      void optionSelectors;
      return rest;
    });
  }

  async fill(values: Map<string, FieldValue>, files: Record<"resume" | "cover_letter", UploadFile | null>) {
    for (const [key, value] of values) {
      const field = this.fields.get(key);
      if (!field) continue;
      const locator = this.page.locator(field.selector).first();

      switch (value.type) {
        case "text":
          await locator.fill(value.value);
          break;
        case "option":
          if (field.kind === "radio") {
            const selector = field.optionSelectors?.[value.value];
            if (selector) await this.page.locator(selector).first().check({ force: true });
          } else {
            await locator.selectOption({ label: value.value });
          }
          break;
        case "check":
          await locator.setChecked(value.value, { force: true });
          break;
        case "file": {
          const file = files[value.file];
          if (file) await locator.setInputFiles(file);
          break;
        }
      }
    }
  }

  async blockingCaptcha(): Promise<string | null> {
    // An interactive challenge (checkbox or image grid) needs a human. The
    // invisible reCAPTCHA some Greenhouse boards use is attempted; if it
    // rejects the submission, the confirmation check below reports it.
    const challenge = await this.page.$(
      "iframe[src*='hcaptcha.com'], .h-captcha, iframe[src*='recaptcha'][src*='anchor']:not([src*='size=invisible'])",
    );
    return challenge ? "This form requires solving a CAPTCHA" : null;
  }

  async submit(): Promise<SubmitOutcome> {
    const startUrl = this.page.url();
    const button = this.page
      .locator(
        "form button[type='submit'], form input[type='submit'], #submit_app, button:has-text('Submit application'), button:has-text('Submit')",
      )
      .first();
    await button.click({ timeout: 10_000 });

    const confirmed = await this.page
      .waitForFunction(
        ({ source, flags, start }) =>
          new RegExp(source, flags).test(document.body.innerText) ||
          (location.href !== start && /thank|confirm|success/i.test(location.href)),
        { source: SUCCESS_TEXT.source, flags: SUCCESS_TEXT.flags, start: startUrl },
        { timeout: CONFIRMATION_TIMEOUT_MS },
      )
      .then(() => true)
      .catch(() => false);

    if (confirmed) return { ok: true, message: "Application submitted" };

    const errors = await this.page
      .locator("[class*='error']:visible, [role='alert']:visible")
      .allInnerTexts()
      .catch(() => [] as string[]);
    const detail = errors.map((text) => text.trim()).filter(Boolean).slice(0, 3).join("; ");
    return {
      ok: false,
      message: detail
        ? `The form did not confirm the submission: ${detail}`
        : "The form did not confirm the submission (it may have been blocked by a CAPTCHA)",
    };
  }

  async close() {
    await this.browser.close().catch(() => undefined);
  }
}

export async function launchDriver(): Promise<FormDriver> {
  let chromium: typeof import("playwright-core").chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new BrowserUnavailableError("playwright-core is not installed");
  }

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH?.trim() || undefined,
    });
  } catch (error) {
    throw new BrowserUnavailableError(
      `Could not start Chromium (set CHROMIUM_PATH): ${error instanceof Error ? error.message.split("\n")[0] : error}`,
    );
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  // Bundlers that preserve function names (esbuild's keepNames, used by tsx)
  // wrap inner functions in a `__name` helper that does not exist in the page;
  // `scrapeInPage` would throw on it without this shim.
  await context.addInitScript("globalThis.__name ??= (fn) => fn;");
  const page = await context.newPage();
  return new PlaywrightDriver(browser, page);
}
