import { Worker, Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { queueConnection } from '../config/queue';
import { config } from '../config';

interface EmailJobData {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!transporter && config.email.smtpHost) {
    transporter = nodemailer.createTransport({
      host: config.email.smtpHost,
      port: config.email.smtpPort || 587,
      secure: config.email.smtpPort === 465, // true for 465, false for other ports
      auth: config.email.smtpUser
        ? {
            user: config.email.smtpUser,
            pass: config.email.smtpPass || '',
          }
        : undefined,
    });
  }
  return transporter;
}

export function startEmailWorker(): Worker {
  const worker = new Worker<EmailJobData>(
    'email-notifications',
    async (job: Job<EmailJobData>) => {
      const { to, subject, body, html } = job.data;

      const smtpTransporter = getTransporter();
      if (smtpTransporter) {
        await smtpTransporter.sendMail({
          from: config.email.smtpFrom,
          to,
          subject,
          text: body,
          html: html || body,
        });
        if (config.server.isDevelopment) {
          console.log(`✉️ [Email Worker] Email sent to ${to} via SMTP: ${subject}`);
        }
      } else {
        // Mock email log in dev/test/non-smtp environments
        console.log(`✉️ [Mock Email Worker]
To:      ${to}
From:    ${config.email.smtpFrom}
Subject: ${subject}
Body:    ${body}`);
      }
    },
    {
      connection: queueConnection,
      concurrency: 5,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`❌ [Email Worker] Job ${job?.id} failed:`, err);
  });

  return worker;
}
