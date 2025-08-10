package com.evertt;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@SpringBootApplication
public class TheSite {
    // Simple HTML for testing, so I can ensure AWS & all that
    // jazz can host it properly
    public static final String STATIC_CONTENT =
"""
<!DOCTYPE html>
<html>
<head><title>The Site</title></head>
<body>
<h1>The Site.</h1>
<p><i>Coming Soon...</i></p>
</body>
</html>
""";

    @RequestMapping("/")
    @SuppressWarnings("unused")
    String home() {
        return STATIC_CONTENT;
    }

    public static void main(String[] args) {
        SpringApplication.run(TheSite.class, args);
    }
}
