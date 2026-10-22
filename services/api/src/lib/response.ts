import { Response } from 'express';

export const success = (res: Response, data: any, message?: string, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

export const error = (res: Response, message: string, statusCode = 500, details?: any) => {
  return res.status(statusCode).json({
    success: false,
    error: message,
    details
  });
};
