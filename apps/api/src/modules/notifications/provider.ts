export type SendEmailInput = {
  to: string;
  dynamicTemplateId: string;
  dynamicTemplateData: Record<string, unknown>;
};

export type SendEmailResult = {
  provider: "sendgrid";
  messageId?: string;
};

export interface EmailProvider {
  sendTemplateEmail(input: SendEmailInput): Promise<SendEmailResult>;
}
