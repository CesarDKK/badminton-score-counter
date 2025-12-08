FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy application files
COPY index.html /usr/share/nginx/html/
COPY landing.html /usr/share/nginx/html/
COPY landing-styles.css /usr/share/nginx/html/
COPY landing-script.js /usr/share/nginx/html/
COPY court.html /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY court-script.js /usr/share/nginx/html/

# Copy TV display files
COPY tv.html /usr/share/nginx/html/
COPY tv-styles.css /usr/share/nginx/html/
COPY tv-script.js /usr/share/nginx/html/

# Copy admin files
COPY admin.html /usr/share/nginx/html/
COPY admin-styles.css /usr/share/nginx/html/
COPY admin-script.js /usr/share/nginx/html/

# Copy sponsor files
COPY sponsor.html /usr/share/nginx/html/
COPY sponsor-styles.css /usr/share/nginx/html/
COPY sponsor-script.js /usr/share/nginx/html/

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]