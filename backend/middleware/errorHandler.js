// Global error handler middleware
function errorHandler(err, req, res, next) {
    console.error('Error:', err);

    // Multer file upload errors
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Filen er for stor. Maksimum 10MB.' });
    }

    if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'For mange filer. Maksimum 10 filer ad gangen.' });
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Uventet fil felt.' });
    }

    // Database errors
    if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Duplikat post' });
    }

    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Ugyldig reference' });
    }

    // Validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({ error: err.message });
    }

    // JWT errors
    if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Ugyldig autorisation' });
    }

    // Default error
    res.status(err.status || 500).json({
        error: err.message || 'Intern serverfejl'
    });
}

// 404 handler
function notFoundHandler(req, res) {
    res.status(404).json({ error: 'Endpoint ikke fundet' });
}

module.exports = {
    errorHandler,
    notFoundHandler
};
