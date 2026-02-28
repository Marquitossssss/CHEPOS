import sgMail from "@sendgrid/mail";
import { env } from "../../lib/env.js";
import { EmailProvider, SendEmailInput, SendEmailResult } from "./provider.js";

export class SendGridProvider implements EmailProvider {
  constructor() {
    sgMail.setApiKey(env.sendgridApiKey);
  }

  async sendTemplateEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const [res] = await sgMail.send({
      to: input.to,
      from: env.sendgridFromEmail,
      templateId: input.dynamicTemplateId,
      dynamicTemplateData: input.dynamicTemplateData
    });

    return {
      provider: "sendgrid",
      messageId: res.headers["x-message-id"] as string | undefined
    };
  }
}
