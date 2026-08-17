import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'rawResponse';

/** Opt a handler out of the success envelope (file streams, redirects, etc.). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
