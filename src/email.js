'use strict';

const email = {
  async sendOtp(to, code) {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@nasr.pk',
      to,
      subject: 'Your Nasr login code',
      html: otpHtml(String(code)),
      text: `Your Nasr login code is: ${code}. It expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    });
  },
};

// Table layout + inline styles for email-client compatibility. The code is one
// text node spaced with letter-spacing (not per-digit cells) so copying it
// yields a clean "123456" with no stray spaces.
function otpHtml(code) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Your Nasr login code</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f1ea;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#f4f1ea;">
    Your Nasr login code is ${code}. It expires in 10 minutes.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f1ea;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;">

          <!-- Brand -->
          <tr>
            <td style="padding:0 8px 20px;">
              <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;letter-spacing:0.5px;color:#141c2e;">Nasr</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#fbfaf6;border:1px solid #e4e0d8;border-radius:16px;box-shadow:0 8px 24px rgba(20,28,46,0.06);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                <!-- Accent bar -->
                <tr><td style="height:4px;background:#c8553d;border-radius:16px 16px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>

                <tr>
                  <td style="padding:36px 36px 8px;">
                    <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;font-weight:700;color:#141c2e;">
                      Verify your sign-in
                    </h1>
                    <p style="margin:12px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#5a5648;">
                      Enter this code to finish signing in to your Nasr account. The code expires in <strong style="color:#141c2e;">10 minutes</strong>.
                    </p>
                  </td>
                </tr>

                <!-- 6-digit code -->
                <tr>
                  <td align="center" style="padding:24px 36px 12px;">
                    <div style="display:inline-block;background:#ffffff;border:1px solid #e4e0d8;border-radius:12px;box-shadow:0 1px 2px rgba(20,28,46,0.06);padding:18px 22px 18px 32px;">
                      <span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:32px;font-weight:600;line-height:1;letter-spacing:10px;color:#141c2e;white-space:nowrap;">${code}</span>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td style="padding:8px 36px 36px;">
                    <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#8a8576;">
                      Didn't try to sign in? You can safely ignore this email &mdash; your account stays secure and no changes will be made.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 8px 0;">
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#9a9588;">
                This is an automated message from Nasr. Please don't reply to this email.
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

module.exports = email;
