const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();

const serviceAccount = require("./service_key.json");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Firebase Auth Middleware
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Invalid token", error: error.message });
  }
};

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("ERROR: MONGODB_URI is not defined in .env file");
  process.exit(1);
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("HomeNest");
    const propertiesCollection = db.collection("properties");
    const reviewsCollection = db.collection("reviews");
    const testimonialsCollection = db.collection("testimonials");

    // ============================================
    // PROPERTY ROUTES
    // ============================================

    app.get("/properties", async (req, res) => {
      try {
        const result = await propertiesCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch properties",
          error: error.message,
        });
      }
    });

    app.get("/properties/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid property ID" });
        }

        const result = await propertiesCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).json({ message: "Property not found" });
        }

        res.send(result);
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch property", error: error.message });
      }
    });

    // Get properties by user email
    app.get("/my-properties/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;
        const result = await propertiesCollection
          .find({ "posted_by.email": email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch user properties",
          error: error.message,
        });
      }
    });

    app.post("/properties", verifyToken, async (req, res) => {
      try {
        const newProperty = req.body;
        const result = await propertiesCollection.insertOne(newProperty);
        res.status(201).json({
          message: "Property created successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to create property", error: error.message });
      }
    });

    app.put("/properties/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const updatedProperty = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid property ID" });
        }

        delete updatedProperty._id;

        const result = await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedProperty }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Property not found" });
        }

        res.json({ message: "Property updated successfully" });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to update property", error: error.message });
      }
    });

    app.delete("/properties/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid property ID" });
        }

        const result = await propertiesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Property not found" });
        }

        res.json({ message: "Property deleted successfully" });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to delete property", error: error.message });
      }
    });

    // ============================================
    // REVIEW ROUTES (Property Reviews)
    // ============================================

    // Get ratings/reviews for user's own properties
    app.get("/my-property-ratings/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;

        // Step 1: Find all properties owned by this user
        const userProperties = await propertiesCollection
          .find({ "posted_by.email": email })
          .toArray();

        if (userProperties.length === 0) {
          return res.send([]);
        }

        // Step 2: Get all property IDs
        const propertyIds = userProperties.map((prop) => prop._id.toString());

        // Step 3: Find all reviews for these properties
        const ratings = await reviewsCollection
          .find({ property_id: { $in: propertyIds } })
          .sort({ created_at: -1 })
          .toArray();

        // Step 4: Add property details to each rating
        const ratingsWithPropertyDetails = ratings.map((rating) => {
          const property = userProperties.find(
            (prop) => prop._id.toString() === rating.property_id
          );

          return {
            ...rating,
            property_name: property?.property_name || "Unknown Property",
            property_image: property?.property_image || "",
          };
        });

        res.send(ratingsWithPropertyDetails);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch ratings",
          error: error.message,
        });
      }
    });

    // Get ratings by user email
    app.get("/my-ratings/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;

        // Fetch all ratings/reviews by this user
        const ratings = await reviewsCollection
          .find({ reviewer_email: email })
          .toArray();

        // Populate with property details
        const ratingsWithPropertyDetails = await Promise.all(
          ratings.map(async (rating) => {
            const property = await propertiesCollection.findOne({
              _id: new ObjectId(rating.property_id),
            });

            return {
              ...rating,
              property_name: property?.property_name || "Unknown Property",
              property_image: property?.property_image || "",
            };
          })
        );

        res.send(ratingsWithPropertyDetails);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch ratings",
          error: error.message,
        });
      }
    });

    // Get reviews for a specific property
    app.get("/properties/:id/reviews", async (req, res) => {
      try {
        const { id } = req.params;
        const reviews = await reviewsCollection
          .find({ property_id: id })
          .sort({ created_at: -1 })
          .toArray();
        res.send(reviews);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch reviews",
          error: error.message,
        });
      }
    });

    // Add review to property
    app.post("/properties/:id/reviews", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { rating, review_text, reviewer_email, reviewer_name } = req.body;

        // Check if user already reviewed this property
        const existingReview = await reviewsCollection.findOne({
          property_id: id,
          reviewer_email: reviewer_email,
        });

        if (existingReview) {
          return res.status(400).json({
            message: "You have already reviewed this property",
          });
        }

        const reviewData = {
          property_id: id,
          rating,
          review_text,
          reviewer_email,
          reviewer_name,
          created_at: new Date().toISOString(),
        };

        const result = await reviewsCollection.insertOne(reviewData);
        res.status(201).send({ message: "Review added successfully", result });
      } catch (error) {
        res.status(500).json({
          message: "Failed to add review",
          error: error.message,
        });
      }
    });

    // Update review
    app.put("/reviews/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { rating, review_text } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid review ID" });
        }

        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              rating,
              review_text,
              updated_at: new Date().toISOString(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Review not found" });
        }

        res.send({ message: "Review updated successfully" });
      } catch (error) {
        res.status(500).json({
          message: "Failed to update review",
          error: error.message,
        });
      }
    });

    // Delete review
    app.delete("/reviews/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid review ID" });
        }

        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Review not found" });
        }

        res.send({ message: "Review deleted successfully" });
      } catch (error) {
        res.status(500).json({
          message: "Failed to delete review",
          error: error.message,
        });
      }
    });

    // ============================================
    // TESTIMONIAL ROUTES (Site Reviews)
    // ============================================

    // Get all testimonials
    app.get("/testimonials", async (req, res) => {
      try {
        const testimonials = await testimonialsCollection
          .find()
          .sort({ created_at: -1 })
          .toArray();

        res.json(testimonials);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get testimonial by user email (check if user already has testimonial)
    app.get("/testimonials/user/:email", verifyToken, async (req, res) => {
      try {
        const testimonial = await testimonialsCollection.findOne({
          email: req.params.email,
        });

        if (!testimonial) {
          return res.status(404).json({ error: "No testimonial found" });
        }

        res.json(testimonial);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Create new testimonial
    app.post("/testimonials", verifyToken, async (req, res) => {
      try {
        const testimonial = req.body;

        // Check if user already has a testimonial
        const existingTestimonial = await testimonialsCollection.findOne({
          email: testimonial.email,
        });

        if (existingTestimonial) {
          return res.status(400).json({
            error: "You have already submitted a testimonial",
          });
        }

        const result = await testimonialsCollection.insertOne(testimonial);
        res.status(201).json({
          message: "Testimonial submitted successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Update testimonial
    app.put("/testimonials/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const updateData = req.body;

        delete updateData._id;

        const result = await testimonialsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updateData,
              updated_at: new Date().toISOString(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "Testimonial not found" });
        }

        res.json({ message: "Testimonial updated successfully" });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete testimonial
    app.delete("/testimonials/:id", verifyToken, async (req, res) => {
      try {
        const result = await testimonialsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ error: "Testimonial not found" });
        }

        res.json({ message: "Testimonial deleted successfully" });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("HomeNest API Server Running!");
});

app.listen(port, () => {
  console.log(`HomeNest server listening at http://localhost:${port}`);
});
