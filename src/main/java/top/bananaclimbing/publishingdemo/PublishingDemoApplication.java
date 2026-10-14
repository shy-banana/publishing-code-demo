package top.bananaclimbing.publishingdemo;

import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class PublishingDemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(PublishingDemoApplication.class, args);
    }

    @RestController
    static class AcceptanceController {
        private final JdbcTemplate database;

        AcceptanceController(JdbcTemplate database) {
            this.database = database;
        }

        @GetMapping(value = "/", produces = MediaType.TEXT_PLAIN_VALUE)
        String index() {
            return "Java/Gradle publishing acceptance - Spring Boot 3.5.7\n";
        }

        @GetMapping("/health")
        ResponseEntity<Map<String, Object>> health() {
            try {
                Long count = database.queryForObject("SELECT COUNT(*) FROM publishing_checks", Long.class);
                return ResponseEntity.ok(Map.of("status", "ready", "language", "Java",
                        "buildTool", "Gradle", "database", "connected", "recordCount", count == null ? 0L : count));
            } catch (RuntimeException failure) {
                return ResponseEntity.status(503).body(Map.of("status", "not_ready", "language", "Java",
                        "buildTool", "Gradle", "database", "not_ready"));
            }
        }
    }
}
