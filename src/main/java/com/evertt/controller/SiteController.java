package com.evertt.controller;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SiteController {
    @GetMapping("/")
    public String home(Model model) {
        model.addAttribute("testAttribute", "this is the value!");
        return "home";
    }
}
