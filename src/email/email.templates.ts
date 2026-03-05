const BRAND_COLOR = "#1ec677";
const BG_COLOR = "#0a0a0a";
const CARD_BG = "#141414";
const TEXT_COLOR = "#e2e8f0";
const MUTED_TEXT = "#a9a9a9";

function baseLayout(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:${BG_COLOR}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG_COLOR}; padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <!-- Logo -->
          <tr>
            <td style="padding-bottom:32px;">
              <span style="font-size:24px; font-weight:700; color:${BRAND_COLOR};">SaveX</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color:${CARD_BG}; border-radius:12px; padding:40px 32px; border:1px solid #292929;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top:24px; text-align:center;">
              <p style="color:${MUTED_TEXT}; font-size:12px; margin:0;">
                © ${new Date().getFullYear()} SaveX. All Rights Reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function actionButton(text: string, url: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
      <tr>
        <td align="center">
          <a href="${url}" target="_blank" style="
            display:inline-block;
            background-color:${BRAND_COLOR};
            color:#000000;
            font-size:16px;
            font-weight:600;
            text-decoration:none;
            padding:14px 40px;
            border-radius:8px;
          ">${text}</a>
        </td>
      </tr>
    </table>`;
}

export function verificationEmailTemplate(
  name: string,
  verifyUrl: string,
): { subject: string; html: string } {
  return {
    subject: "Verify your email — SaveX",
    html: baseLayout(`
      <h1 style="color:${TEXT_COLOR}; font-size:22px; font-weight:600; margin:0 0 8px;">Verify your email</h1>
      <p style="color:${MUTED_TEXT}; font-size:15px; line-height:1.6; margin:0 0 4px;">
        Hi${name ? ` ${name}` : ""},
      </p>
      <p style="color:${MUTED_TEXT}; font-size:15px; line-height:1.6; margin:0;">
        Thanks for signing up for SaveX! Please verify your email address by clicking the button below.
      </p>
      ${actionButton("Verify Email", verifyUrl)}
      <p style="color:${MUTED_TEXT}; font-size:13px; line-height:1.6; margin:0;">
        This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
      </p>
    `),
  };
}

export function passwordResetTemplate(
  name: string,
  resetUrl: string,
): { subject: string; html: string } {
  return {
    subject: "Reset your password — SaveX",
    html: baseLayout(`
      <h1 style="color:${TEXT_COLOR}; font-size:22px; font-weight:600; margin:0 0 8px;">Reset your password</h1>
      <p style="color:${MUTED_TEXT}; font-size:15px; line-height:1.6; margin:0 0 4px;">
        Hi${name ? ` ${name}` : ""},
      </p>
      <p style="color:${MUTED_TEXT}; font-size:15px; line-height:1.6; margin:0;">
        We received a request to reset the password for your SaveX account. Click the button below to set a new password.
      </p>
      ${actionButton("Reset Password", resetUrl)}
      <p style="color:${MUTED_TEXT}; font-size:13px; line-height:1.6; margin:0;">
        This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
      </p>
    `),
  };
}

export function accountSuspendedTemplate(
  name: string,
  reason?: string,
): { subject: string; html: string } {
  return {
    subject: "Your account has been suspended — SaveX",
    html: baseLayout(`
      <h1 style="color:${TEXT_COLOR}; font-size:22px; font-weight:600; margin:0 0 8px;">Account Suspended</h1>
      <p style="color:${MUTED_TEXT}; font-size:15px; line-height:1.6; margin:0 0 4px;">
        Hi${name ? ` ${name}` : ""},
      </p>
      <p style="color:${MUTED_TEXT}; font-size:15px; line-height:1.6; margin:0;">
        Your SaveX account has been suspended by an administrator.
      </p>
      ${reason ? `<p style="color:${MUTED_TEXT}; font-size:15px; line-height:1.6; margin:16px 0 0;"><strong style="color:${TEXT_COLOR};">Reason:</strong> ${reason}</p>` : ""}
      <p style="color:${MUTED_TEXT}; font-size:13px; line-height:1.6; margin:24px 0 0;">
        If you believe this was a mistake, please contact our support team.
      </p>
    `),
  };
}
