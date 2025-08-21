package com.evertt.controller;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

import jakarta.servlet.http.HttpServletResponse;

@Controller
public class SiteController {
    // Redirect to home
    @GetMapping(value = "/")
    public void redirectToHome(HttpServletResponse resp) {
        resp.setHeader("Location", "/home");
        resp.setStatus(302);
    }
    // Base page
    @GetMapping(value = "/home")
    public String home(Model model) {
        model.addAttribute("testAttribute", "this is the value!");
        return "home";
    }
}
