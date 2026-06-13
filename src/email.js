'use strict';

const email = {
  async sendOtp(to, code) {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@nasr.app',
      to,
      subject: 'Your Nasr login code',
      html: `<p>Your login code is: <strong>${code}</strong></p><p>It expires in 10 minutes.</p>`,
      text: `Your Nasr login code is: ${code}. It expires in 10 minutes.`,
    });
  },
};

module.exports = email;
