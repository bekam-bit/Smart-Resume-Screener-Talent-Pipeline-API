import nodemailer from "nodemailer";
import { env } from "../../src/config/env.js";

async function testPorts() {
  const ports = [587, 2525, 465, 25];

  for (const port of ports) {
    console.log(`Testing port ${port}...`);
    const transport = nodemailer.createTransport({
      host: "sandbox.smtp.mailtrap.io",
      port,
      secure: port === 465,
      auth: {
        user: env.MAILTRAP_USER,
        pass: env.MAILTRAP_PASS
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000
    });

    try {
      await transport.verify();
      console.log(`>>> PORT ${port} CONNECTED AND VERIFIED SUCCESSFULLY! <<<`);
      await transport.sendMail({
        from: env.EMAIL_FROM,
        to: "candidate-alex@anyrandomdomain.io",
        subject: `Mailtrap Live Verification (Port ${port})`,
        html: `<h2>Mailtrap Connected on Port ${port}!</h2><p>Your backend can now send emails to any address via Mailtrap Sandbox.</p>`,
        text: `Mailtrap Connected on Port ${port}!`
      });
      console.log(`>>> Test email sent successfully via port ${port}! <<<`);
      return port;
    } catch (err: any) {
      console.log(`Port ${port} failed:`, err.message || err.code);
    }
  }
  console.log("All ports tested.");
}

testPorts().catch(console.error);
