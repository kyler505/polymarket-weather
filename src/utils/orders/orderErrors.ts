/**
 * Order Error Handling Utilities
 * Extracts and classifies errors from Polymarket CLOB API responses
 */

/**
 * Extract error message from various response formats
 */
export const extractOrderError = (response: unknown): string | undefined => {
    if (!response) {
        return undefined;
    }

    if (typeof response === 'string') {
        return response;
    }

    if (typeof response === 'object') {
        const data = response as Record<string, unknown>;

        const directError = data.error;
        if (typeof directError === 'string') {
            return directError;
        }

        if (typeof directError === 'object' && directError !== null) {
            const nested = directError as Record<string, unknown>;
            if (typeof nested.error === 'string') {
                return nested.error;
            }
            if (typeof nested.message === 'string') {
                return nested.message;
            }
        }

        if (typeof data.errorMsg === 'string') {
            return data.errorMsg;
        }

        if (typeof data.message === 'string') {
            return data.message;
        }
    }

    return undefined;
};

/**
 * Check if error indicates insufficient balance or allowance
 */
export const isInsufficientBalanceOrAllowanceError = (message: string | undefined): boolean => {
    if (!message) {
        return false;
    }
    const lower = message.toLowerCase();
    return lower.includes('not enough balance') || lower.includes('allowance');
};

/**
 * Check if error message indicates rate limiting (Cloudflare block, etc.)
 */
export const isRateLimitError = (message: string | undefined): boolean => {
    if (!message) {
        return false;
    }
    const lower = message.toLowerCase();
    return (
        lower.includes('been blocked') ||
        lower.includes('cloudflare') ||
        lower.includes('rate limit') ||
        lower.includes('too many requests') ||
        lower.includes('403') ||
        lower.includes('429')
    );
};
