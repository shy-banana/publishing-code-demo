package top.bananaclimbing.publishingdemo;

import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringBootVersion;
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
            return "Java/Maven publishing acceptance - Spring Boot 3.5.7\n";
        }

        @GetMapping("/health")
        ResponseEntity<Map<String, Object>> health() {
            try {
                Map<String, Object> proof = database.queryForMap(
                        "SELECT current_user AS database_role, "
                        + "COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS database_tls, "
                        + "(SELECT COUNT(*) FROM publishing_checks) AS record_count");
                boolean tls = Boolean.TRUE.equals(proof.get("database_tls"));
                boolean roleVerified = "runtime_app".equals(proof.get("database_role"));
                if (!tls || !roleVerified) {
                    return ResponseEntity.status(503).body(Map.of("status", "not_ready", "language", "Java",
                            "buildTool", "Maven", "database", "not_ready"));
                }
                return ResponseEntity.ok(Map.of("status", "ready", "language", "Java",
                        "buildTool", "Maven", "database", "connected", "databaseTls", tls,
                        "databaseRoleVerified", roleVerified, "framework", "Spring Boot " + SpringBootVersion.getVersion(),
                        "recordCount", proof.get("record_count")));
            } catch (RuntimeException failure) {
                return ResponseEntity.status(503).body(Map.of("status", "not_ready", "language", "Java",
                        "buildTool", "Maven", "database", "not_ready"));
            }
        }
    }
}
