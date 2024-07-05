from django.shortcuts import render
from .models import Blog

# home app created. It will return the html. Probably it is pulling from the templates root directory. 
def home(requests):
    return render(requests, 'landing/index.html', {})
def contact(requests):
    return render(requests, 'landing/contact.html', {})
def blog(requests):
    blogs = Blog.objects.all()
    return render(requests, 'landing/blog.html', {"blogs": blogs})
def about(requests):
    return render(requests, 'landing/about.html', {})
def faq(requests):
    return render(requests, 'landing/faq.html', {})