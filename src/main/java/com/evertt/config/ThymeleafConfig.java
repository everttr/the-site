package com.evertt.config;

import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationContextAware;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.spring6.templateresolver.SpringResourceTemplateResolver;
import org.thymeleaf.spring6.view.ThymeleafViewResolver;
import org.thymeleaf.templatemode.TemplateMode;

@Configuration
@EnableWebMvc
public class ThymeleafConfig implements WebMvcConfigurer, ApplicationContextAware {
    private ApplicationContext appCxt;

    @Override
    public void setApplicationContext(ApplicationContext appCxt) {
        this.appCxt = appCxt;
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry reg) {
        reg.addResourceHandler("/static/**").addResourceLocations("classpath:/static/");
        reg.addResourceHandler("/favicon.ico").addResourceLocations("classpath:/static/favicon.ico");
    }

    @Bean
    public ThymeleafViewResolver thymeleafViewResolver() {
        var vr = new ThymeleafViewResolver();
        vr.setTemplateEngine(templateEngine());
        return vr;
    }

    @Bean
    public SpringTemplateEngine templateEngine() {
        var te = new SpringTemplateEngine();
        te.setTemplateResolver(thymeleafTemplateResolver());
        return te;
    }

    @Bean
    public SpringResourceTemplateResolver thymeleafTemplateResolver() {
        var tr = new SpringResourceTemplateResolver();
        tr.setTemplateMode(TemplateMode.HTML);
        tr.setPrefix("classpath:WEB-INF/templates/");
        tr.setSuffix(".html");
        tr.setCacheTTLMs(3_600_000L);
        return tr;
    }
}
