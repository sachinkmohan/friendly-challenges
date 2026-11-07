import serverless from 'serverless-http'
import { serve } from '../../src/handler.ts'

export const handler = serverless(serve)
