-- Office 'Sales' role: capped to the finished-goods Stock by Design register.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SALES';
