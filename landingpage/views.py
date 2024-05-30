from django.shortcuts import render

# home app created. It will return the html. Probably it is pulling from the templates root directory. 
def home(requests):
    return render(requests, 'landing/index.html', {})
