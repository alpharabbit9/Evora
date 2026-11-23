import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { E2E_PRODUCT } from "../fixtures";
import { signInAsAdmin, signUp } from "../support/helpers";

/**
 * The shopping assistant in the browser (ADR 0025), against the local Groq and OpenAI stand-ins
 * the config starts. The stand-ins follow a fixed policy (call the most fitting tool once, then
 * name what it returned), so these check the store's side: the widget, the stream, the live
 * product cards, the draft-policy label and the guest/customer difference. Answer quality is
 * judged by the eval set against the real providers, not here.
 */
test.describe("shopping assistant", () => {
  test("a guest finds a product and follows its card to the product page", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Ask the shopping assistant" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Shopping assistant" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Sign in to ask about your orders."),
    ).toBeVisible();

    await dialog
      .getByRole("textbox", { name: "Message the shopping assistant" })
      .fill("a field jacket for autumn");
    await dialog.getByRole("button", { name: "Send" }).click();

    const log = dialog.getByRole("log", { name: "Conversation" });
    await expect(
      log.getByText(`Here is what I found: ${E2E_PRODUCT.name}`),
    ).toBeVisible();
    const card = log
      .getByRole("list", { name: "Products the assistant found" })
      .getByRole("link", {
        name: new RegExp(E2E_PRODUCT.name),
      });
    await expect(card).toContainText("৳4,500");

    await card.click();
    await expect(page).toHaveURL(new RegExp(`/products/${E2E_PRODUCT.slug}$`));
  });

  test("a policy answer names its source and says it is a draft", async ({
    page,
  }) => {
    await page.goto("/shop");
    await page
      .getByRole("button", { name: "Ask the shopping assistant" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Shopping assistant" });

    await dialog
      .getByRole("button", { name: "How much is delivery outside Dhaka?" })
      .click();

    await expect(dialog.getByText("Draft policy").first()).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "Shipping" }).first(),
    ).toHaveAttribute("href", /^\/shipping/);
  });

  test("a signed-in customer is offered order questions and keeps the chat after reloading", async ({
    page,
  }) => {
    await signUp(page);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Ask the shopping assistant" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Shopping assistant" });

    await dialog
      .getByRole("button", { name: "Where is my latest order?" })
      .click();
    // A new customer has no orders; the stand-in says it found nothing.
    await expect(
      dialog
        .getByRole("log", { name: "Conversation" })
        .getByText("I couldn't find anything matching that."),
    ).toBeVisible();

    await page.reload();
    await page
      .getByRole("button", { name: "Ask the shopping assistant" })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: "Shopping assistant" })
        .getByText("Where is my latest order?"),
    ).toBeVisible();
  });

  test("the open chat has no serious accessibility violations", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Ask the shopping assistant" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Shopping assistant" });
    await dialog
      .getByRole("textbox", { name: "Message the shopping assistant" })
      .fill("field jacket");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(
      dialog
        .getByRole("log", { name: "Conversation" })
        .getByText(`Here is what I found: ${E2E_PRODUCT.name}`),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
  });

  test("an administrator reviews a conversation, and the review is audited", async ({
    browser,
  }) => {
    const guest = await browser.newPage();
    await guest.goto("/");
    await guest
      .getByRole("button", { name: "Ask the shopping assistant" })
      .click();
    const dialog = guest.getByRole("dialog", { name: "Shopping assistant" });
    await dialog
      .getByRole("textbox", { name: "Message the shopping assistant" })
      .fill("admin review jacket");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(
      dialog
        .getByRole("log", { name: "Conversation" })
        .getByText(/Here is what I found/),
    ).toBeVisible();
    await guest.close();

    const admin = await browser.newPage();
    await signInAsAdmin(admin);
    await admin.goto("/admin/assistant");
    await expect(
      admin.getByRole("heading", { level: 1, name: "Assistant chats" }),
    ).toBeVisible();
    // The list never shows what was written.
    await expect(admin.getByText("admin review jacket")).toHaveCount(0);

    await admin.getByRole("link", { name: /^Open/ }).first().click();
    await expect(
      admin.getByRole("heading", { level: 1, name: "Assistant conversation" }),
    ).toBeVisible();
    await expect(
      admin.getByText("This view was recorded in the audit log.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(admin.getByRole("list", { name: "Messages" })).toContainText(
      "admin review jacket",
    );

    await admin.goto("/admin/audit");
    await expect(
      admin.getByRole("cell", { name: "Assistant chat viewed" }).first(),
    ).toBeVisible();
    await admin.close();
  });

  test("Escape closes the chat and returns focus to the launcher", async ({
    page,
  }) => {
    await page.goto("/");
    const launcher = page.getByRole("button", {
      name: "Ask the shopping assistant",
    });
    await launcher.click();
    await expect(
      page.getByRole("dialog", { name: "Shopping assistant" }),
    ).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(
      page.getByRole("dialog", { name: "Shopping assistant" }),
    ).toBeHidden();
    await expect(launcher).toBeFocused();
  });
});
