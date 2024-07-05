from django.db import models

# Create your models here.
from django.utils import timezone

class Blog(models.Model):
    blog_title = models.CharField(max_length=200)
    blog_date = models.DateTimeField(default=timezone.now)
    blog_description = models.TextField()
    blog_author = models.CharField(max_length=100)

    def __str__(self):
        return self.blog_title